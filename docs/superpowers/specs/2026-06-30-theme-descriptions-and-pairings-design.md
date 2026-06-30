# Theme descriptions + recommended pairings

## Goal

For each theme in a series, add to the output:
1. **description** — 1-2 sentence "how the deck plays" summary (e.g. "big creatures", "spell heavy").
2. **recommendedPairings** — 3-5 other themes from the same series that combine well into a
   40-card deck, each with a 1-2 sentence reason. Jumpstart packs are designed to be combined
   two at a time, so this reflects real deckbuilding intent, not just flavor.

## Architecture

Two additions to the existing pipeline, no new phases at the orchestration level beyond one
extra step between decklist assembly and pricing:

1. **Description** is folded into the *existing* extraction agent calls
   (`extractDecklist` / `extractThemeFromPage`). These agents already read the full decklist
   to pull out cards, so adding a `description` field to the same tool call is free — no new
   Claude calls.
2. **Pairings** require comparing every theme in the series against every other theme (to
   avoid same-color pairings, balance archetypes, etc.), so they need one consolidated call
   that sees the whole series at once. This is a **new agent call**, `analyzeSynergies`, made
   **once per series run** (not once per theme) using **Sonnet** instead of Haiku — synergy
   judgment needs real Magic deckbuilding reasoning, which is worth the extra cost for a
   single call.

Flow in `mtg-jumpstarts.ts`:

```
discoverThemes → extract decklists (now includes description)
  → attach colors (existing)
  → analyzeSynergies(themes)   // NEW: one Sonnet call, returns pairings per theme
  → merge pairings onto decklists
  → priceDecklists (existing, unchanged)
  → printResults / exportXlsx (now show description + pairings)
```

Pairings don't depend on pricing, so this step can run independently of `priceDecklists`
(implementation may run them concurrently via `Promise.all`, since neither depends on the
other's output).

## Data model (`src/types.ts`)

```ts
export type Decklist = {
  theme: string;
  color?: string;
  categories: Category[];
  description: string;        // NEW
};

export type Pairing = { theme: string; reason: string };  // NEW

export type PricedDecklist = {
  theme: string;
  color: string;
  categories: PricedCategory[];
  deckTotal: number;
  powerTier: number;
  description: string;            // NEW
  recommendedPairings: Pairing[]; // NEW
};
```

## Tool schemas (`src/tools.ts`)

- `DECKLIST_ITEM_SCHEMA` gains a required `description` field:
  ```ts
  description: { type: 'string', description: 'How this deck plays in 1-2 sentences, e.g. "big creatures", "spell heavy", "lots of tokens"' }
  ```
  This flows into both `DECKLIST_TOOL` and `DECKLISTS_TOOL` automatically since they both
  reuse `DECKLIST_ITEM_SCHEMA`.

- New `PAIRINGS_TOOL`:
  ```ts
  export const PAIRINGS_TOOL: Anthropic.Tool = {
    name: 'report_pairings',
    description: 'Report recommended deck pairings for every theme in the series',
    input_schema: {
      type: 'object',
      properties: {
        pairings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              theme: { type: 'string', description: 'The theme these pairings are for' },
              recommendations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    theme: { type: 'string', description: 'Name of the recommended pairing theme (must be from the provided list)' },
                    reason: { type: 'string', description: '1-2 sentences on why this pairs well with the main theme specifically' },
                  },
                  required: ['theme', 'reason'],
                },
              },
            },
            required: ['theme', 'recommendations'],
          },
        },
      },
      required: ['pairings'],
    },
  };
  ```

## Agent (`src/agents.ts`)

```ts
export async function analyzeSynergies(
  client: Anthropic,
  semaphore: Semaphore,
  themes: { name: string; color: string; description: string }[],
): Promise<Map<string, Pairing[]>>
```

- Calls `callAgent` with `PAIRINGS_TOOL`. `callAgent` (src/claude.ts) gains a 6th optional
  parameter `model = 'claude-haiku-4-5-20251001'`, so every existing call site is unchanged
  and `analyzeSynergies` is the only caller passing `'claude-sonnet-5'` explicitly.
- Input content: a compact list, one line per theme — `"<name> (<color>): <description>"`.
  No card lists — descriptions are sufficient and keep the call cheap.
- Prompt instructions:
  > "Jumpstart packs are 20-card half-decks designed to be combined two at a time into one
  > 40-card deck. For each theme below, recommend 3-5 other themes from this same list that
  > would combine well, using Magic deckbuilding fundamentals (curve, removal/threat balance,
  > complementary archetypes, color identity). Generally avoid pairing two decks of the same
  > color — Jumpstart by design discourages mono-color pairs — unless there's a genuinely
  > compelling synergistic reason, in which case explain why. For each recommendation, give a
  > 1-2 sentence reason specific to why it pairs with *this* theme, not a generic blurb. If
  > the series has very few themes, it's fine to return fewer than 3 — never fabricate
  > pairings."
- Returns a `Map<themeName, Pairing[]>` built from the tool result.
- Defensive filtering when merging back in the caller: drop any recommended pairing whose
  `theme` doesn't match a real theme name in the input list (handles model hallucination
  without a retry).

### Error handling

- Wrapped in `withRetry` like other agent calls.
- If it fails after retries, the caller catches it, logs to stderr
  (`✗ pairing analysis: <err>`), and every deck falls back to `recommendedPairings: []`.
  This must not abort the run — decklists and prices already succeeded by this point.

## Orchestration (`mtg-jumpstarts.ts`)

After `coloredDecklists` is built (existing code, ~line 137-140):

```ts
const synergyInput = coloredDecklists.map(d => ({ name: d.theme, color: d.color, description: d.description }));
const pairingsMap = await analyzeSynergies(client, semaphore, synergyInput)
  .catch(err => { console.error(`✗ pairing analysis: ${err}`); return new Map(); });

const decklistsWithPairings = coloredDecklists.map(d => ({
  ...d,
  recommendedPairings: (pairingsMap.get(d.theme) ?? [])
    .filter(p => coloredDecklists.some(o => o.theme === p.theme)),
}));

const pricedDecklists = await priceDecklists(decklistsWithPairings);
```

`priceDecklists` (src/pricing.ts) needs a small update to pass `description` and
`recommendedPairings` through onto `PricedDecklist` (it currently constructs the priced
object field-by-field, so these two fields need to be added to that object literal).

## Output (`src/output.ts`)

**`printResults`** — after the `--- Theme ---` header line, before categories:
```
--- Angels ---
Big flying creatures backed by lifegain and combat tricks.
Pairs well with: Demons (aggressive black removal smooths Angels' weaker early game), Spirits (...)
```
One line per deck: `Pairs well with: <theme> (<reason>), <theme> (<reason>), ...`. If
`recommendedPairings` is empty, omit the "Pairs well with" line entirely.

**`exportXlsx`**:
- Summary sheet gains a `Description` column (after `Power (1-5)`/`Stars`, before the
  per-type $ columns).
- New third sheet **"Pairings"**: one row per (theme, recommended pairing) —
  columns `Deck`, `Recommended Pairing`, `Why`. Omitted (no rows) for decks with no pairings.

**`exportCsv`** — unchanged, per prior agreement (one-row-per-card format doesn't fit free
text + arrays well; redundant duplication on every row was explicitly rejected).

## Out of scope

- Cross-series pairing (pairings only ever reference themes within the same run/series).
- A CLI flag to disable this — it always runs (per requirements).
- Sub-agent/parallel fan-out for finding pairings — a single consolidated Sonnet call is
  sufficient since it only needs compact descriptions, not full decklists, to reason about
  synergy.
