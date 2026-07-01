# Front-card playstyle + tips

## Goal

The deck insert card's front face today prints a single full-paragraph `description`.
Replace that on the **card only** with two new baked fields:

1. `playstyle` — 1-3 short keyword tags for the deck's overall archetype (e.g. "Big
   creatures", "Buffs").
2. `tips` — 3-5 short, punchy, human-readable strategy/combo bullets: how to actually
   play the deck (e.g. "Lean into exile to recycle cards"). This is the lengthiest
   section on the card.

Character length is at a premium on a 2"x3.5" card — bullets and 1-6 word phrases only,
no full sentences, no filler.

The existing full-paragraph `description` stays untouched for general chat use (e.g.
"what pairs well with X") — this change adds fields, it doesn't remove one.

Also renamed on the card: "Suggested Pairings" → "Synergies" (label only, no behavior
change — see `2026-06-30-richer-deck-descriptions-design.md` for why the pairing
`reason` field is already keyword-style).

## Architecture

`playstyle`/`tips` are baked at data-generation time, same as `description` — **not**
reasoned live by the calling Claude at request time (unlike pairings, which stay
Claude-reasoned). This matches the existing split: `description` is already baked via
oracle-text-grounded Sonnet calls in `describeDecks`; `playstyle`/`tips` are additional
outputs of that same call, at no extra API cost.

```
describeDecks (Sonnet, oracle text in context)
  → { description, playstyle, tips } per theme
  → baked into data/<slug>.json
  → get_jumpstart_decklists returns all three
  → format_deck_insert_card takes playstyle + tips as pass-through input (description dropped)
```

`format_deck_insert_card` remains a pure formatter: Claude passes `playstyle`/`tips`
straight through from `get_jumpstart_decklists`'s response, unedited — same treatment as
`theme`/`color`/`cards` today. Only `pairings` is still Claude-authored per call.

## `types.ts` changes

Additive fields, alongside existing `description: string`, on all three deck-shape
types:

```ts
export type Decklist = {
  theme: string;
  color?: string;
  categories: Category[];
  description: string;
  playstyle: string[];
  tips: string[];
};

export type PricedDecklist = {
  theme: string;
  color: Color;
  description: string;
  playstyle: string[];
  tips: string[];
  cards: PricedCard[];
  cardCount: number;
  deckTotal: number;
  powerLevel: number;
};

export type BakedDecklist = {
  theme: string;
  color: Color;
  description: string;
  playstyle: string[];
  tips: string[];
  cards: BakedCard[];
};
```

## `tools.ts` changes (`DESCRIPTIONS_TOOL`)

Add two properties per theme row, alongside the unchanged `description`:

```ts
playstyle: {
  type: 'array',
  items: { type: 'string' },
  description:
    'Overall playstyle as 1-3 short keyword tags (e.g. ["Big creatures", "Buffs"]) — ' +
    'tags, not sentences.',
},
tips: {
  type: 'array',
  items: { type: 'string' },
  description:
    '3-5 short, punchy, human-readable tips for how to actually play this deck — general ' +
    'strategy and any concrete combos, grounded in the specific cards and their rules text ' +
    'provided (e.g. "Lean into exile to recycle cards"). Each tip is a short phrase, 1-6 ' +
    'words, not a full sentence. Avoid generic filler unless immediately backed by specifics.',
},
```

`required` on the row gains `'playstyle'` and `'tips'`.

## `agents.ts` changes (`describeBatch` / `describeDecks`)

- Prompt instructions extended: after the existing full-paragraph description
  instructions, add a short block asking for the same grounding (real cards/oracle
  text, no fabricated combos) but output as keyword tags (`playstyle`) and punchy
  bullets (`tips`) rather than prose.
- Return type changes from `Map<string, string>` to
  `Map<string, { description: string; playstyle: string[]; tips: string[] }>`.
- The double-wrapped-JSON normalization (claude-sonnet-5's occasional escaped-string
  quirk, already handled) stays as-is — same tool call, more fields per row.

## `baking.ts` / `pricing.ts` changes

Both already pass `description` straight through from their respective input shape to
their output shape. Add `playstyle`/`tips` as two more straight pass-through fields at
the same two spots — no other logic changes.

## `scripts/refresh-data.ts` changes

`describeDecks`'s result merge (`coloredDecklists.map(d => ({ ...d, description:
descriptions.get(d.theme) ?? d.description }))`) extends to also pull `playstyle` and
`tips` off the same per-theme result object, defaulting to `[]` if a theme is somehow
missing from the batch result (mirrors the existing `?? d.description` fallback
pattern).

Extraction functions (`agents.ts`, the two spots that currently default
`description: ''`) also default `playstyle: []` and `tips: []` — same "placeholder
until the description-generation step runs" treatment.

## `mcp-server.ts` / `deckInsertCard.ts` changes

`format_deck_insert_card` input schema: remove `description: z.string()`, add:

```ts
playstyle: z.array(z.string()).min(1).max(3)
  .describe('Keyword tags for overall playstyle, e.g. ["Big creatures", "Buffs"] — pass through from get_jumpstart_decklists verbatim, do not rewrite'),
tips: z.array(z.string()).min(1).max(5)
  .describe('Short punchy strategy/combo bullets (1-6 words each) — pass through from get_jumpstart_decklists verbatim, do not rewrite'),
```

`DeckInsertCardInput` type: same change (`description: string` → `playstyle: string[];
tips: string[]`).

Front-face formatter output:

```
Marvel Super Heroes
Agents of S.H.I.E.L.D.
Color: White
Power Level: ●●○○○
Leader: Nick Fury, Spymaster (Rare)

Playstyle: Attack-alone aggro, Buffs

Tips:
  - Send lone attacker, stack buffs
  - Fury cheats in extra body
  - Coulson's counters snowball threat

Synergies:
  Soaring (Blue) - low curve, evasive, aggressive clock
```

- `Playstyle:` line: tags joined `, `.
- `Tips:` header + one `  - ` bulleted line per tip, in the order given.
- `Synergies:` — same rendering as today's "Suggested Pairings", label only changes.
- No change to series/theme/color/power-level/leader lines, or to the back face.

## `SKILL.md` changes

"Generating a deck insert card" step 3: replace `description` with `playstyle, tips` in
the list of fields passed to `format_deck_insert_card` straight from
`get_jumpstart_decklists` — no derivation step needed, they're baked.

"`powerLevel` caveat" section: "read the `cards` and `description` fields" → "read the
`cards`, `description`, `playstyle`, and `tips` fields."

No change to "Giving recommendations" (still uses `description` for full-sentence chat
answers) or to pairing-reason guidance (already keyword-style, untouched).

## README.md changes

Example JSON response gains `playstyle`/`tips` fields next to the existing
`description` field.

## Testing

No test framework in this repo. Verify manually:
1. Run `scripts/refresh-data.ts "Marvel Super Heroes"` (requires `ANTHROPIC_API_KEY`) —
   test-regenerate `data/marvel.json` only.
2. Spot-check 3-4 themes: `playstyle` is short tags (not sentences), `tips` are punchy
   and grounded (not generic filler), `description` is unchanged in style/length from
   before.
3. Run the MCP server locally, call `get_jumpstart_decklists` for Marvel, confirm all
   three fields are present and match the baked file.
4. Call `format_deck_insert_card` for one theme; confirm the front face renders
   Playstyle/Tips/Synergies as shown above, and the back face is unchanged.

## Rollout

1. Ship code changes now (this repo).
2. Regenerate `data/marvel.json` only, as a test, once `ANTHROPIC_API_KEY` is available.
3. Regenerating the other 5 series is a separate, later action — not part of this
   change — once Marvel's output is confirmed good. (Explicit user decision: code now,
   data regen later.)

## Out of scope

- Regenerating any `data/*.json` file as part of this change (deferred, see Rollout).
- Removing or changing `description` anywhere it's used for chat/general purposes.
- xlsx/CSV export columns for `playstyle`/`tips` (`output.ts`) — the export tool wasn't
  asked to change.
- Renaming the "Leader:"/"Leaders:" label (kept as-is, explicit user decision).
- Any change to pairing/synergy selection logic, leader selection, back-face rendering,
  or print-sizing math — all unchanged from
  `2026-06-30-deck-insert-card-design.md`.
