# Deck insert card generator

## Goal

Generate the text for a printable double-sided deck insert card (business-card sized,
2"x3.5", portrait orientation) for a single Jumpstart theme:

- **Front**: series, theme, color, power level, leader card(s) (the pack's rare/mythic
  "face" card), description, up to 5 suggested pairings (theme + color + reason each).
- **Back**: the full 20-card decklist, grouped by category, each card tagged with rarity
  and color.

## Architecture

Pairing suggestions require real Magic deckbuilding judgment (color synergy, curve, threat
balance) — that reasoning already lives in `skills/jumpstart-deck-strategy/SKILL.md` and is
done live by the calling Claude, not hardcoded server-side (see README: "Deck pairings aren't
pre-computed"). This feature follows the same split:

1. Claude calls the existing `get_jumpstart_decklists` tool to get a series' decks.
2. Claude reasons about up to 5 pairings for the target theme, using the heuristics already
   documented in the skill.
3. Claude calls a **new** MCP tool, `format_deck_insert_card`, passing the target theme's own
   data (already in hand from step 1, including per-card rarity/colors — see below) plus the
   pairings it chose in step 2.

The new tool is a **pure text formatter** — no network calls, no file reads, no Claude API
calls. Leader-card selection is deterministic (highest rarity present), not a judgment call,
so it lives in the formatter too, not in the skill.

```
get_jumpstart_decklists → Claude reasons about pairings (skill) → format_deck_insert_card → text
```

One card per call — no batch/whole-series mode. If a user wants cards for a whole series,
Claude loops the 3-step flow once per theme.

## Data pipeline: rarity + colors

`get_jumpstart_decklists` already fetches live Scryfall data for pricing via
`fetchScryfallPrices` → `/cards/collection` (`src/scryfall.ts`). That same API response
already includes `rarity` and `colors` for every card — confirmed live against the real
"Agents of S.H.I.E.L.D." deck (e.g. `Nick Fury, Spymaster` → `rare`, `['W']`; `Plains` →
`common`, `[]`). **No baked-data regeneration needed** — this is purely capturing fields
already present in a call that's already being made.

- `scryfall.ts`: rename `fetchScryfallPrices` → `fetchScryfallCardData`. Returns
  `Map<string, { price: number | null; rarity: string | null; colors: string[] }>` instead of
  `Map<string, number | null>`. `colors` stays in Scryfall's own W/U/B/R/G shorthand — no
  conversion needed, it's already the abbreviated form the back-of-card needs.
- `types.ts`: `PricedCard` gains `rarity: string | null` and `colors: string[]`.
- `pricing.ts`: `priceDecklists` passes the new fields through onto each `PricedCard`. This is
  the only construction site for `PricedCard`, so no other call sites need updating.
- This is an additive, non-breaking change to `get_jumpstart_decklists`'s public output.

## New tool (`src/mcp-server.ts`)

```ts
server.registerTool(
  'format_deck_insert_card',
  {
    title: 'Format deck insert card',
    description: 'Format the front and back text for a printable double-sided Jumpstart deck insert card (2"x3.5", portrait), given one theme\'s deck data and its suggested pairings. Reason about the pairings yourself (see the jumpstart-deck-strategy skill) before calling this — it only formats, it does not choose pairings.',
    inputSchema: {
      series: z.string().optional(),
      theme: z.string(),
      color: z.enum(['white', 'blue', 'black', 'red', 'green', 'multi']),
      description: z.string(),
      powerLevel: z.number().int().min(1).max(5),
      cards: z.array(z.object({
        title: z.string(),
        type: z.string(),
        qty: z.number().int(),
        rarity: z.string().nullable(),
        colors: z.array(z.string()),
      })).min(1),
      pairings: z.array(z.object({
        theme: z.string(),
        color: z.string(),
        reason: z.string(),
      })).min(1).max(5),
    },
  },
  async (input) => {
    const { front, back } = formatDeckInsertCard(input);
    return { content: [{ type: 'text' as const, text: front }, { type: 'text' as const, text: back }] };
  },
);
```

Two separate content blocks (front, back) instead of one combined string. No error branches
beyond zod's own schema validation — there's no I/O to fail.

## Formatter (`src/deckInsertCard.ts`)

```ts
export function formatDeckInsertCard(input: DeckInsertCardInput): { front: string; back: string }
```

### Leader card(s)

Deterministic, not reasoned: rank rarity (`mythic` > `rare`/`special`/`bonus` > `uncommon` >
`common`), take cards ranked **uncommon or higher**, find the max rank among those, and list
*every* card at that max rank (deduped by title) — not just one. Ties are common in practice
(verified: "Agents of S.H.I.E.L.D." has 2 tied rares, no mythic), so forcing a single pick
would be arbitrary. If no card ranks above common (or rarity data is missing), omit the
Leader(s) line entirely rather than dumping the whole card list.

### Front

Plain text, no hard-wrapping — the description and pairing reasons are free-text prose;
Claude/the user's layout tool reflows them naturally.

```
Marvel Super Heroes
Agents of S.H.I.E.L.D.
Color: White
Power Level: ●●○○○
Leaders: Agent Phil Coulson, Nick Fury, Spymaster (Rare)

An agent-focused deck with espionage and support cards that leverages
S.H.I.E.L.D. themed creatures and equipment to control the board.

Suggested Pairings:
  Soaring (Blue) - shares a low curve and evasive threats for an
    aggressive, synergistic clock.
  ...
```

- `series` line omitted if not provided.
- Deck-level `color` capitalized for display (`white` → `White`, `multi` → `Multicolor`).
- Pairing `color` (free text from Claude) is capitalized for display consistency regardless of
  the case Claude sent it in — cosmetic normalization only, not validation.
- "Leader:" (singular) vs "Leaders:" (plural) depending on count.

### Back

```
Agents of S.H.I.E.L.D.

Creatures (7)
  Agent Phil Coulson (Rare, W)
  Peggy Carter, Secret Agent (Uncommon, W)
  Agent 13, Sharon Carter (Uncommon, W)
  Agents of S.H.I.E.L.D. (Common, W)
  Quake, Agent of S.H.I.E.L.D. (Uncommon, W)
  Borough Backup (Common, W)
  Nick Fury, Spymaster (Rare, W)
Instants (1)
  Helicarrier Strike (Common, W)
Enchantments (2)
  Strategic Intervention (Uncommon, W)
  Web Up (Common, W)
Artifacts (2)
  S.H.I.E.L.D. Helicarrier (Uncommon, C)
  S.H.I.E.L.D. Spy Kit (Common, W)
Lands (8)
  Thriving Heath (Common, C)
  7x Plains (Common, C)
```

Per-card line: `  {qty > 1 ? qty + 'x ' : ''}{title} ({Rarity}, {Colors})`.

- No qty prefix for the (overwhelming) common case of qty 1; restored (`7x `) only when qty >
  1. This isn't land-specific — it's a general rule, and it also correctly covers the rare
  non-land duplicates that exist in the real baked data (e.g. 2x "Archaeomender" in Jumpstart
  2020, 2x "Ancestral Anger" in Foundations) without special-casing card type.
- Rarity spelled out (`Rare`, `Uncommon`, `Common`, `Mythic`) — capitalized from Scryfall's
  lowercase value. Kept as full words (not abbreviated) to avoid colliding with `C` for
  colorless.
- Colors use Scryfall's own shorthand directly: `W`/`U`/`B`/`R`/`G`, joined `/` for multicolor
  (e.g. `W/U`), `C` for colorless (empty `colors` array — artifacts, lands).
- No forced column-alignment/right-justification of the `(Rarity, Colors)` tag, and no
  programmatic line-wrapping. See "Print sizing math" below for why this was tried and
  rejected — plain inline text, single space before the tag, is the right call for the actual
  physical target.
- No `(N cards)` on the title line (always 20, guaranteed, redundant) — category headers keep
  their counts since those genuinely vary per theme.

### Print sizing math (why no alignment/wrapping)

Explored during design, kept here since the reasoning isn't obvious from the code:

- A monospace character is ≈0.6× the font's point size wide, so characters-per-inch ≈
  120 / font-size-pt (matches classic Courier metrics: 12pt = 10 CPI).
- The back face has a **hard floor** of ~21 lines (title + 5 category headers + one line per
  card) — every line must appear, there's no graceful degradation for cutting a card.
- Landscape orientation (3.5" wide × 2" tall) can't fit 21 lines below ~5pt — unusable.
  Portrait (2" wide × 3.5" tall) fits 21 lines at a readable ~9-11pt. **Portrait is the
  intended orientation.**
- Portrait's width is only ~19-23 characters at that font size. A fixed-column
  right-justified table (tag always starting at the same column, wrapping to a second line
  when a card entry doesn't fit) was prototyped and rejected: at that width almost every card
  wraps, growing the back face from 21 to 33-35 lines — worse than not aligning at all.
- Plain inline text (`title (Rarity, Colors)`, single space, no padding) lets each user's own
  print/layout tool reflow naturally instead of us forcing a 2-line split on nearly every
  entry.

## Skill update (`skills/jumpstart-deck-strategy/SKILL.md`)

Add a "Generating a deck insert card" section covering:

1. The 3-step flow (call `get_jumpstart_decklists` → reason about pairings using the
   heuristics already in this skill → call `format_deck_insert_card` with the theme's data +
   those pairings).
2. **Presentation instructions** (this is the actual fix for the original complaint — Claude
   had been paraphrasing the tool's output into prose instead of relaying it): the tool
   returns 2 text blocks (front, back). Relay each **verbatim** in its own fenced code block
   under a short header (e.g. "**FRONT** (copy this):" / "**BACK** (copy this):"). Do not
   summarize, paraphrase, merge into prose, or add/drop any line — the whole point is
   copy/paste-ready print content.

## Testing

No test framework exists in this repo. Verify manually: run the MCP server locally, call
`format_deck_insert_card` with the real "Agents of S.H.I.E.L.D." deck (including live
rarity/colors from Scryfall) plus a few hand-picked pairings, and confirm output matches the
shape above — leader selection (both tied rares appear), category grouping/counts, qty-prefix
rule, color abbreviation/colorless handling, series-omitted case.

## Out of scope

- Batch/whole-series generation in one call.
- Any pricing information on the card (front or back) — rarity/color data is fetched via the
  same Scryfall call as price, but price itself is never part of this tool's output, including
  as an internal tiebreaker (leader ties are shown in full instead of arbitrarily broken by
  price).
- Hard-wrapping/column-fitting text to the physical 2"x3.5" dimensions — rejected after doing
  the print-sizing math (see above); plain inline text instead.
- Hardcoded/server-side pairing logic — pairings always come from the caller.
