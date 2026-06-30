# Structured JSON output + normalized color

## Problem

Today's default output is human-formatted text (`printResults`), printed to
stdout with stars, indentation, and inline warnings. Downstream consumers
(scripts, `jq`, other tools) have to scrape text instead of reading data.

Two related gaps:

1. Each deck's `color` is the raw wiki scrape (`White`/`Blue`/`Black`/`Red`/`Green`/`Other`/``),
   not a clean enum.
2. The recently-added synergy recommendations (`recommendedPairings`) are
   `{theme, reason}` — missing the paired deck's color, and named
   inconsistently with the rest of the desired output shape.

## Goals

- Replace the default stdout output with structured, pretty-printed JSON.
- Normalize `color` to a 6-value enum: `white`, `blue`, `black`, `red`, `green`, `multi`.
- Flatten each deck's cards into one array (no category nesting), with a
  `type` field per card carrying the old category name.
- Rename `powerTier` → `powerLevel`, `recommendedPairings` → `synergies`
  (with `{title, color, reasoning}` shape) throughout the codebase.
- Keep CSV/XLSX exports working, updated to source from the new flat shape.

## Non-goals

- No new CLI flags. JSON replaces default stdout; redirection (`> file.json`)
  already covers "write JSON to a file" per the existing piping convention.
- No changes to the Claude extraction prompts/schemas for decklist content
  (card/category extraction stays as-is) — only the synergy tool's `reason`
  field is renamed to `reasoning` for consistency.
- No retry/validation logic changes.

## Design

### 1. `Color` type + normalization

New type in `src/types.ts`:

```ts
export type Color = 'white' | 'blue' | 'black' | 'red' | 'green' | 'multi';
```

New helper (`src/types.ts` or a small `src/color.ts`):

```ts
function normalizeColor(raw: string): Color {
  const known: Record<string, Color> = { white: 'white', blue: 'blue', black: 'black', red: 'red', green: 'green' };
  return known[raw.toLowerCase()] ?? 'multi';
}
```

Applied once in `mtg-jumpstarts.ts`, where decklists currently get
`color: match?.color ?? ''` attached from theme discovery. Empty string,
`Other`, and any unrecognized value all normalize to `'multi'`.

`Theme.color` and `Decklist.color` stay raw strings (internal,
pre-normalization); normalization happens at the point decks are colored,
before pricing.

### 2. Flattened card schema

`src/types.ts`:

```ts
export type PricedCard = {
  title: string;
  type: string;       // old category name, e.g. "Creatures"
  qty: number;
  unitPrice: number | null;
  lineTotal: number | null;
};

export type Synergy = {
  title: string;
  color: Color;
  reasoning: string;
};

export type PricedDecklist = {
  theme: string;
  color: Color;
  description: string;
  cards: PricedCard[];
  cardCount: number;
  deckTotal: number;
  powerLevel: number; // 1–5, z-score relative to series
  synergies: Synergy[];
};
```

`Card`, `Category`, and the raw `Decklist` type (used by the Claude
extraction agents) are unchanged — they're the Claude tool_use contract, not
the final output shape.

The agent-level synergy type (`src/types.ts`, replacing `Pairing`):

```ts
export type AgentSynergy = { theme: string; reasoning: string };
```

`Decklist.recommendedPairings?` → `Decklist.synergies?: AgentSynergy[]`.

### 3. `src/pricing.ts`

`priceDecklists` flattens while pricing instead of building
`PricedCategory[]`:

- For each category, for each card, push
  `{ title: card.name, type: category.name, qty, unitPrice, lineTotal: unitPrice !== null ? unitPrice * qty : null }`.
- `cardCount` = sum of `qty` across all cards (replaces the inline
  `totalCards` calc that lived in `printResults`).
- If `cardCount !== 20`, log
  `⚠ ${theme}: ${cardCount} cards (expected 20)` to stderr (matches today's
  inline warning, moved to a diagnostic channel since stdout is now JSON).
- z-score tiering logic unchanged; output field renamed `powerLevel`.

### 4. `src/agents.ts` / `src/tools.ts`

- `PAIRINGS_TOOL` schema: `recommendations[].reason` → `recommendations[].reasoning`.
- `analyzeSynergies` return type updates to `Map<string, AgentSynergy[]>`.
- `mergeRecommendedPairings` → `mergeSynergies`: for each recommendation,
  look up the target theme's normalized color from the series' own
  decklists (`themes` array, already available in `mtg-jumpstarts.ts`) and
  produce `{ title: theme, color, reasoning }`. Hallucinated theme names
  (not in the series) are still dropped, as today.

### 5. `src/output.ts`

- `printResults` removed. New `printResultsJson(keyword, decklists)`:
  ```ts
  console.log(JSON.stringify({ series: keyword, themeCount: decklists.length, decks: decklists }, null, 2));
  ```
- `exportCsv`: reads `deck.cards` directly (already flat); `Type` column
  comes from `card.type`. Header `Power Tier` → `Power Level`.
- `exportXlsx`:
  - Summary sheet: groups `deck.cards` by `card.type` to rebuild the
    per-category `$` columns (same visible output as today).
  - Cards sheet: reads `deck.cards` directly, `Unit ($)`/`Line Total ($)`
    columns now use `card.unitPrice`/`card.lineTotal` directly (no
    recomputation).
  - Pairings sheet → **Synergies** sheet, columns `Deck`, `Synergy`, `Color`, `Reasoning`.
  - All `Power Tier` headers → `Power Level`.

### 6. `mtg-jumpstarts.ts`

- Wire `mergeSynergies` in place of `mergeRecommendedPairings`.
- Apply `normalizeColor` where `color: match?.color ?? ''` is currently set.
- Call `printResultsJson` instead of `printResults`.

### 7. `README.md`

- Replace the "Output" example with a JSON sample reflecting the new shape.
- Update the CSV color doc line: `White/Blue/Black/Red/Green/Other` →
  `white/blue/black/red/green/multi`.
- `Power Tier` → `Power Level` references.

## Testing

- Run against a small series (e.g. `Foundations Jumpstart`) and confirm:
  - stdout is valid JSON (`| jq .` succeeds).
  - Every deck's `color` is one of the 6 enum values.
  - `cards` is flat with `title`/`type`/`qty`/`unitPrice`/`lineTotal`.
  - `synergies` entries carry `title`/`color`/`reasoning`.
  - `--csv` and `--xlsx` exports still produce the same visible columns/rows
    as before (modulo header renames).
  - A deck with a non-20 card count logs the stderr warning.
