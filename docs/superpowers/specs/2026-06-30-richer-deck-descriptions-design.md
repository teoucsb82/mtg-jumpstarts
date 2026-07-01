# Richer deck descriptions + condensed pairing reasons

## Goal

Today's `description` field (baked into `data/<slug>.json`, one per theme) is a generic
1-2 sentence guess — e.g. "A multicolor deck themed around the Fantastic Four with a
four-card game-winning combo" — because it's written by Claude from card *names* alone,
with no rules text. It can't name a real interaction because it doesn't know one.

Replace it with a full-paragraph description that states actual playstyle/strategy and, when
the cards genuinely support it, 1-2 named combos grounded in real oracle text — the way a
human player skimming the decklist with Scryfall open would describe it. Also condense the
*pairing* reasons shown on the printable deck insert card from full sentences to short
keyword tags, since the card is physically tiny and a full-paragraph description already
eats more of that space.

## Problem, concretely

Verified by hand against the "Fantastic" (Fantastic Four) theme in Marvel Super Heroes:
looking up oracle text on Scryfall showed The Fantastic Four's ETB/cast trigger cycles
through four modes (Wall token / 3 damage / +1+1 counters / draw), and each of the four
Human Torch / Mister Fantastic / Invisible Woman / The Thing hero cards hooks into exactly
one of those modes, chaining into each other. None of that is visible from card names alone
— the current pipeline has no way to produce it.

## Architecture

```
discoverThemes → extract cards only (Haiku, no description)
  → attach colors (existing, unchanged)
  → fetch oracle text for every unique card in the series (Scryfall, transient)
  → generate descriptions (Sonnet, batched ~10 themes/call, oracle text in context)
  → bakeSeries (unchanged shape — description is still just a string field)
```

Key change: description generation moves **out** of the per-theme extraction calls and
becomes **one unified post-processing step that runs for every series type** (today only
the LOTR/"Type C" inline-decklist path had a separate description step via `describeDecks`;
Type A/B extraction folded description into the same call as card extraction). Unifying
means:
- Extraction agents (Haiku) do one job — pull cards accurately — and stop guessing at
  playstyle without data to back it up.
- Every series gets oracle-text-grounded descriptions, not just LOTR.
- Oracle text is fetched **once per unique card name in the series**, not per-theme (a card
  like "Plains" or a reused hero doesn't get re-fetched).

Oracle text is transient — used only to write the description, not persisted in
`data/<slug>.json`. Keeps baked file size unchanged; `pricing.ts` already re-fetches
rarity/colors/price live per-request, so there's precedent for not baking Scryfall-sourced
data.

## `scryfall.ts` changes

Add oracle text to the existing bulk `/cards/collection` fetch (already the exact API call
used for pricing — no new endpoint, just reading one more field off the same response):

```ts
export type ScryfallCardData = {
  price: number | null;
  rarity: string | null;
  colors: string[];
  text: string | null;   // NEW
};
```

Populate from `card.oracle_text`, falling back to joined `card_faces[].oracle_text` for
MDFC/transform cards (e.g. some Marvel cards flip):

```ts
const text = card.oracle_text
  ?? (card.card_faces?.map(f => f.oracle_text).filter(Boolean).join(' // ') || null);
```

`unknown` fallback constant gains `text: null`. This is additive — `pricing.ts` keeps
constructing `PricedCard` the same way and simply ignores the new field.

## `types.ts` changes

None to the baked/priced shapes — `description: string` already exists everywhere it needs
to. Only new plumbing is an internal `Map<string, string | null>` (card name → oracle text)
passed through the bake script, not a persisted type.

## `tools.ts` changes

`DECKLIST_ITEM_SCHEMA` **loses** the `description` property (and drops it from `required`).
Extraction agents no longer report a description at all:

```ts
export const DECKLIST_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    theme: { type: 'string', description: 'Theme name' },
    categories: { /* unchanged */ },
  },
  required: ['theme', 'categories'],
};
```

`DESCRIPTIONS_TOOL`'s `description` field gets the new instruction text:

```ts
description: {
  type: 'string',
  description:
    'A full paragraph (not 1-2 sentences) describing how this deck actually plays: its ' +
    'strategy and playstyle, grounded in the specific cards and their rules text provided. ' +
    'When the cards genuinely interact — e.g. one card\'s trigger feeds another\'s ability — ' +
    'name 1-2 concrete combos explicitly, citing the actual card names and what they do. ' +
    'Do not fabricate a combo that isn\'t really there: if the deck is a straightforward ' +
    'value/curve pile with no standout interaction, say so plainly and describe its game ' +
    'plan instead. Avoid generic filler ("big creatures", "spell heavy", "lots of tokens") ' +
    'unless immediately backed by specifics.',
},
```

(The old field description literally used those three filler phrases as *examples to
follow* — that's a direct cause of the genericness, so the new text calls them out as
what to avoid instead.)

## `agents.ts` changes

- `extractDecklist` / `extractThemeFromPage`: drop the "Also write a 1-2 sentence
  description..." paragraph from their prompts. Each now returns cards with
  `description: ''` (defensive default — schema no longer asks the model for one, but the
  shared `Decklist` type still has the field, populated later).
- `describeDecks`: reworked to accept oracle text and run for **all** series types, not just
  inline ones:

  ```ts
  export async function describeDecks(
    client: Anthropic,
    semaphore: Semaphore,
    decks: { theme: string; categories: Category[] }[],
    cardText: Map<string, string | null>,
  ): Promise<Map<string, string>>
  ```

  - Batches `decks` into groups of ~10 themes (chunking helper, plain array slicing) and
    fires one Sonnet call per batch via `Promise.all` — batches run concurrently, bounded by
    the existing `Semaphore(10)`. Keeps any single call's output well under token limits even
    for 50-theme series (Avatar, Marvel) and avoids one theme's outlier length blowing up a
    giant single call.
  - Per-card content line becomes `{qty}x {name} — {oracle text}` (omit the em-dash/text
    when oracle text is unavailable, e.g. a name Scryfall didn't match).
  - Calls `callAgent(..., maxTokens: 8192, model: 'claude-sonnet-5')` — Sonnet because
    spotting real combos from rules text is a genuine reasoning task, not extraction; Haiku
    stays on card extraction where it's already reliable.
  - Merges batch results into one `Map<theme, description>`, same return shape as today.

## `scripts/refresh-data.ts` changes

The `if (inlineDecks.length > 0) { ... describeDecks ... } else { ... }` branch currently
only calls `describeDecks` on the LOTR path. New flow: both branches produce
`coloredDecklists` with `description: ''`, then **one** unified step runs after, regardless
of path:

```ts
console.error('\nFetching oracle text for description generation...');
const allCardNames = [...new Set(
  coloredDecklists.flatMap(d => d.categories.flatMap(c => c.cards.map(card => card.name))),
)];
const cardData = await fetchScryfallCardData(allCardNames);
const cardText = new Map([...cardData].map(([name, info]) => [name, info.text]));

console.error(`Generating descriptions for ${coloredDecklists.length} themes (Sonnet, batched)...`);
const descriptions = await describeDecks(client, semaphore, coloredDecklists, cardText);
coloredDecklists = coloredDecklists.map(d => ({ ...d, description: descriptions.get(d.theme) ?? d.description }));
```

This is a new Scryfall dependency at *bake* time (previously Scryfall was only called at
MCP-request time, in `pricing.ts`). No API key needed for Scryfall (same as today's
pricing calls) — only `ANTHROPIC_API_KEY` is required, unchanged.

## Pairing reasons: condensed to keywords

Separate from the description work but bundled into this change since it's the same
surface (the printable insert card) and the same root motivation (less generic, better use
of limited card space):

- `format_deck_insert_card`'s `pairings[].reason` schema description
  (`src/mcp-server.ts`) changes from *"1-2 sentences on why this pairs well with the main
  theme"* to *"5-6 keywords or a short phrase capturing the playstyle synergy (e.g. 'ally
  colors, mana fixing, protects combo') — not a full sentence."*
- `skills/jumpstart-deck-strategy/SKILL.md`, "Generating a deck insert card" step 2: change
  "Write a specific 1-2 sentence reason for each" to the same keyword-tag instruction.
- This only affects the **insert-card** pairing flow. The general "Giving recommendations"
  conversational guidance (SKILL.md, answering "what pairs well with X" in chat) is
  untouched — full-sentence reasoning still applies there; there's no print-space
  constraint in a chat answer.
- No code change in `deckInsertCard.ts` — it already prints `reason` as opaque text after
  a ` - `; a short tag string formats the same way a sentence did.

## Print impact

No formatter code changes. `deckInsertCard.ts`'s front face already prints `description`
and each pairing `reason` as unwrapped plain text (see the existing "Print sizing math"
section in `docs/superpowers/specs/2026-06-30-deck-insert-card-design.md` — deliberately no
hard-wrapping, left to the user's print/layout tool). A full paragraph simply reflows to
more lines; condensed pairing tags claim less space than before, partially offsetting it.

## Testing

No test framework in this repo (per `DEVELOPMENT.md`). Verify manually:
1. Run `scripts/refresh-data.ts "Marvel Super Heroes"` (requires `ANTHROPIC_API_KEY`),
   regenerating `data/marvel.json` only, as a test of the new pipeline.
2. Spot-check 3-4 themes in the new file: confirm descriptions are full paragraphs, name
   real combos where they exist (e.g. "Fantastic" should mention the four-mode engine),
   and plainly describe strategy (no fabricated combo) for a theme that's just a value pile.
3. Run the MCP server locally, call `get_jumpstart_decklists` for Marvel, confirm
   `description` matches the baked file.
4. Generate one deck insert card end-to-end (`format_deck_insert_card`) and confirm the
   front face renders the full paragraph and keyword-style pairing reasons.

## Rollout

1. Ship the code changes now (this repo).
2. Regenerate `data/marvel.json` only, as a test, once `ANTHROPIC_API_KEY` is available in
   the shell.
3. Regenerating the other 5 series (`data/*.json`) is a separate, later action — not part
   of this change — once Marvel's output is confirmed good.

## Out of scope

- Regenerating all 6 series' data now (explicitly deferred — Marvel only, as a test).
- Persisting oracle text itself in `data/*.json`.
- Changing `powerLevel` computation or any pricing logic.
- Changing the general conversational pairing-recommendation guidance in SKILL.md (only the
  insert-card-specific reason format changes).
- Hard-wrapping/column-fitting the printed card to the physical 2"x3.5" dimensions — already
  rejected in the prior deck-insert-card design; unchanged here.
