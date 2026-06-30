# Theme Descriptions + Recommended Pairings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 1-2 sentence `description` ("how the deck plays") and a 3-5 entry `recommendedPairings`
list (with synergy reasons) to every theme's output, shown in the console printout and the XLSX export.

**Architecture:** `description` is folded into the existing per-theme extraction agent calls (no new
Claude calls). `recommendedPairings` requires comparing every theme against every other theme in the
series, so it's computed by one new consolidated Sonnet call (`analyzeSynergies`) made once per series
run, inserted between decklist extraction and pricing in `mtg-jumpstarts.ts`.

**Tech Stack:** TypeScript (run via `tsx`, no build step), `@anthropic-ai/sdk`, `xlsx`.

## Global Constraints

- Pairing analysis always runs — no CLI flag to disable it (confirmed: always-on).
- `analyzeSynergies` uses model `claude-sonnet-5`; every other agent call keeps using
  `claude-haiku-4-5-20251001` (the existing default) — confirmed via design Q&A.
- Pairings only ever reference themes within the same series/run. Never fabricate a pairing if the
  series doesn't have enough qualifying themes — `analyzeSynergies` may legitimately return fewer than 3.
- Output surfaces: console (`printResults`) and XLSX (`exportXlsx`) only. `exportCsv` is explicitly
  unchanged — its one-row-per-card shape doesn't fit free text + arrays well (confirmed, redundancy
  on every row rejected).
- Defensive filtering: any recommended pairing theme name that isn't a real theme in the series is
  dropped when merging results back — no retry, just filtered out.
- `mtg-jumpstarts.ts` and `src/output.ts` already have pre-existing uncommitted changes (XLSX export
  support) unrelated to this work. Tasks 6 and 7 must NOT run `git commit` on these files — committing
  would sweep in that unrelated pre-existing diff too (confirmed: leave it uncommitted, don't touch).
  Edit them, verify with tsc, but skip the commit step for those two tasks specifically.
- No new test framework or `tests/` directory — this project has none today and verification for
  agent-calling code is done by running the tool end-to-end against the real API (existing convention,
  see `mtg-jumpstarts.ts` doc comment). Type-correctness across the plumbing changes is verified with
  `npx -y -p typescript tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext mtg-jumpstarts.ts`
  after every task (confirmed working against current code with zero errors).

---

## Task 1: Types

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `Pairing = { theme: string; reason: string }`, `Decklist.description: string`,
  `Decklist.recommendedPairings?: Pairing[]`, `PricedDecklist.description: string`,
  `PricedDecklist.recommendedPairings: Pairing[]`. All later tasks import these.

- [x] **Step 1: Edit `src/types.ts`**

Replace the full file contents with:

```ts
export type Theme = { name: string; url: string; color: string };
export type Card = { qty: number; name: string };
export type Category = { name: string; cards: Card[] };
export type Pairing = { theme: string; reason: string };
export type Decklist = {
  theme: string;
  color?: string;
  categories: Category[];
  description: string;
  recommendedPairings?: Pairing[];
};

export type PricedCard = Card & { unitPrice: number | null };
export type PricedCategory = { name: string; cards: PricedCard[]; categoryTotal: number };
export type PricedDecklist = {
  theme: string;
  color: string;
  categories: PricedCategory[];
  deckTotal: number;
  powerTier: number; // 1–5, z-score relative to series
  description: string;
  recommendedPairings: Pairing[];
};
```

- [x] **Step 2: Type-check**

Run: `npx -y -p typescript tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext mtg-jumpstarts.ts`

Expected: exactly one error, in `src/pricing.ts` (it constructs a `PricedDecklist` object literal
that's now missing `description`/`recommendedPairings`):

```
src/pricing.ts(45,3): error TS2322: Type '{ powerTier: number; theme: string; color: string; categories: PricedCategory[]; deckTotal: number; }[]' is not assignable to type 'PricedDecklist[]'.
  Type '{ powerTier: number; theme: string; color: string; categories: PricedCategory[]; deckTotal: number; }' is missing the following properties from type 'PricedDecklist': description, recommendedPairings
```

`src/agents.ts` and `src/output.ts` stay clean at this point — `agents.ts` only casts API responses
to `Decklist`/`Pairing` via generics (no object literals checked structurally yet), and `output.ts`
doesn't read the new fields until Task 7.

- [x] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "Add description and recommendedPairings to Decklist/PricedDecklist types"
```

---

## Task 2: Tool schemas

**Files:**
- Modify: `src/tools.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DECKLIST_ITEM_SCHEMA` now requires `description`. New export `PAIRINGS_TOOL`
  (`Anthropic.Tool`) — input shape `{ pairings: { theme: string; recommendations: { theme: string; reason: string }[] }[] }`.

- [x] **Step 1: Add `description` to `DECKLIST_ITEM_SCHEMA`**

In `src/tools.ts`, change:

```ts
export const DECKLIST_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    theme: { type: 'string', description: 'Theme name' },
    categories: {
```

to:

```ts
export const DECKLIST_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    theme: { type: 'string', description: 'Theme name' },
    description: {
      type: 'string',
      description: 'How this deck plays in 1-2 sentences, e.g. "big creatures", "spell heavy", "lots of tokens"',
    },
    categories: {
```

and change the `required` array on the same schema from:

```ts
  required: ['theme', 'categories'],
};
```

to:

```ts
  required: ['theme', 'description', 'categories'],
};
```

- [x] **Step 2: Add `PAIRINGS_TOOL`**

Append to the end of `src/tools.ts`:

```ts
// Used by analyzeSynergies: returns recommended deck pairings for every theme in the series
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

- [x] **Step 3: Type-check**

Run: `npx -y -p typescript tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext mtg-jumpstarts.ts`

Expected: the same single `src/pricing.ts` error as Task 1 Step 2 (confirmed by trial run) — no new
errors from `tools.ts` itself.

- [x] **Step 4: Commit**

```bash
git add src/tools.ts
git commit -m "Add description field to decklist schema and new PAIRINGS_TOOL"
```

---

## Task 3: `callAgent` model override

**Files:**
- Modify: `src/claude.ts`

**Interfaces:**
- Produces: `callAgent<T>(client, semaphore, tool, instructions, htmlContent, maxTokens, model = 'claude-haiku-4-5-20251001')`.
  Existing call sites (5 args) are unaffected; new callers can pass a 7th arg to override the model.

- [x] **Step 1: Edit `callAgent` signature and usage**

In `src/claude.ts`, change:

```ts
export async function callAgent<T>(
  client: Anthropic,
  semaphore: Semaphore,
  tool: Anthropic.Tool,
  instructions: string,
  htmlContent: string,
  maxTokens: number,
): Promise<T> {
  return semaphore.run(async () => {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
```

to:

```ts
export async function callAgent<T>(
  client: Anthropic,
  semaphore: Semaphore,
  tool: Anthropic.Tool,
  instructions: string,
  htmlContent: string,
  maxTokens: number,
  model = 'claude-haiku-4-5-20251001',
): Promise<T> {
  return semaphore.run(async () => {
    const response = await client.messages.create({
      model,
```

- [x] **Step 2: Type-check**

Run: `npx -y -p typescript tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext mtg-jumpstarts.ts`

Expected: identical error set to Task 2 Step 3 — no new errors introduced by this change (it's purely
additive/backward compatible).

- [x] **Step 3: Commit**

```bash
git add src/claude.ts
git commit -m "Allow callAgent to override the model per call"
```

---

## Task 4: `analyzeSynergies` + `mergeRecommendedPairings`, and description prompts

**Files:**
- Modify: `src/agents.ts`

**Interfaces:**
- Consumes: `PAIRINGS_TOOL` (Task 2), `callAgent`/`withRetry`/`Semaphore` (Task 3, `src/claude.ts`),
  `Pairing`/`Decklist` types (Task 1, `src/types.ts`).
- Produces:
  - `analyzeSynergies(client, semaphore, themes: { name: string; color: string; description: string }[]): Promise<Map<string, Pairing[]>>`
  - `mergeRecommendedPairings(decklists: Decklist[], pairingsMap: Map<string, Pairing[]>): Decklist[]`
  Both consumed by `mtg-jumpstarts.ts` in Task 6.

- [x] **Step 1: Update the import line**

In `src/agents.ts`, change:

```ts
import type { Theme, Decklist } from './types.js';
import { stripHtml } from './fetch.js';
import { THEMES_TOOL, DECKLIST_TOOL, DECKLISTS_TOOL } from './tools.js';
```

to:

```ts
import type { Theme, Decklist, Pairing } from './types.js';
import { stripHtml } from './fetch.js';
import { THEMES_TOOL, DECKLIST_TOOL, DECKLISTS_TOOL, PAIRINGS_TOOL } from './tools.js';
```

- [x] **Step 2: Tell the extraction agents to write a description**

In `extractThemeFromPage`, change:

```ts
Ignore every other theme on this page. Return only decklists for "${theme.name}".

Use the report_decklists tool to return the decklist(s) you find.
```

to:

```ts
Ignore every other theme on this page. Return only decklists for "${theme.name}".

For each decklist, also write a 1-2 sentence description of how the deck plays (e.g. "big creatures",
"spell heavy", "lots of tokens") based on the cards in it.

Use the report_decklists tool to return the decklist(s) you find.
```

In `extractDecklist`, change:

```ts
Extract the theme name and all cards grouped by category (Creatures, Instants, Sorceries,
Enchantments, Artifacts, Planeswalkers, Lands, etc.). Preserve category order as shown.
Use qty=1 for any card with no explicit quantity listed.

Use the report_decklist tool to return the structured decklist.
```

to:

```ts
Extract the theme name and all cards grouped by category (Creatures, Instants, Sorceries,
Enchantments, Artifacts, Planeswalkers, Lands, etc.). Preserve category order as shown.
Use qty=1 for any card with no explicit quantity listed.

Also write a 1-2 sentence description of how the deck plays (e.g. "big creatures", "spell heavy",
"lots of tokens") based on the cards you extracted.

Use the report_decklist tool to return the structured decklist.
```

- [x] **Step 3: Add `analyzeSynergies` and `mergeRecommendedPairings`**

Append to the end of `src/agents.ts`:

```ts
// ─── Synergy / pairing recommendations ────────────────────────────────────────
// One consolidated call per series: sees every theme's description + color at once,
// so it can reason about the whole series (e.g. avoid same-color pairings) instead
// of judging each theme in isolation. Uses Sonnet — synergy judgment needs real
// Magic deckbuilding reasoning, not just structured extraction.

export async function analyzeSynergies(
  client: Anthropic,
  semaphore: Semaphore,
  themes: { name: string; color: string; description: string }[],
): Promise<Map<string, Pairing[]>> {
  const content = themes.map(t => `${t.name} (${t.color}): ${t.description}`).join('\n');

  const instructions = `You are a Magic: The Gathering deckbuilding expert analyzing a Jumpstart series.
Jumpstart packs are 20-card half-decks designed to be combined two at a time into one 40-card deck.

For each theme below, recommend 3-5 OTHER themes from this same list that would combine well into a
40-card deck, using Magic deckbuilding fundamentals (curve, removal/threat balance, complementary
archetypes, color identity). Generally avoid pairing two decks of the same color — Jumpstart by design
discourages mono-color pairs — unless there's a genuinely compelling synergistic reason, in which case
explain why in the reason.

For each recommendation, give a 1-2 sentence reason specific to why it pairs well with THIS theme, not
a generic blurb. Only recommend themes that appear in the list below. If the series has very few
themes, it's fine to return fewer than 3 — never fabricate a pairing.

Use the report_pairings tool to return recommendations for every theme listed.

THEMES:`;

  const result = await withRetry(
    () => callAgent<{ pairings: { theme: string; recommendations: Pairing[] }[] }>(
      client, semaphore, PAIRINGS_TOOL, instructions, content, 8192, 'claude-sonnet-5',
    ),
    'pairing analysis',
  );

  return new Map(result.pairings.map(p => [p.theme, p.recommendations ?? []]));
}

// Defensive merge: drop any recommended theme name that doesn't actually exist in this
// series (handles model hallucination without a retry).
export function mergeRecommendedPairings(
  decklists: Decklist[],
  pairingsMap: Map<string, Pairing[]>,
): Decklist[] {
  const validThemes = new Set(decklists.map(d => d.theme));
  return decklists.map(d => ({
    ...d,
    recommendedPairings: (pairingsMap.get(d.theme) ?? []).filter(p => validThemes.has(p.theme)),
  }));
}
```

- [x] **Step 4: Type-check**

Run: `npx -y -p typescript tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext mtg-jumpstarts.ts`

Expected: the same single `src/pricing.ts` error, unchanged (confirmed by trial run) — no errors in
`src/agents.ts`.

- [x] **Step 5: Verify `mergeRecommendedPairings` filtering logic in isolation**

This is the one piece of new pure logic in this task (the hallucination filter), so verify it directly
rather than waiting for a full end-to-end API run. Write this to the scratchpad (not committed):

`/private/tmp/claude-501/-Users-teodellamico-Code-mtg-jumpstarts/91545188-45d3-4a6f-9933-75425742eb9d/scratchpad/verify-merge.ts`

```ts
import assert from 'node:assert/strict';
import { mergeRecommendedPairings } from '/Users/teodellamico/Code/mtg-jumpstarts/src/agents.ts';

const decklists = [
  { theme: 'Angels', color: 'White', categories: [], description: 'flyers' },
  { theme: 'Demons', color: 'Black', categories: [], description: 'removal' },
];

const pairingsMap = new Map([
  ['Angels', [
    { theme: 'Demons', reason: 'real pairing' },
    { theme: 'Nonexistent Theme', reason: 'should be dropped' },
  ]],
]);

const result = mergeRecommendedPairings(decklists, pairingsMap);

assert.deepEqual(result[0].recommendedPairings, [{ theme: 'Demons', reason: 'real pairing' }]);
assert.deepEqual(result[1].recommendedPairings, []);

console.log('mergeRecommendedPairings: OK');
```

Run: `npx tsx /private/tmp/claude-501/-Users-teodellamico-Code-mtg-jumpstarts/91545188-45d3-4a6f-9933-75425742eb9d/scratchpad/verify-merge.ts`

Expected output: `mergeRecommendedPairings: OK`

- [x] **Step 6: Commit**

```bash
git add src/agents.ts
git commit -m "Add analyzeSynergies pairing agent and description prompts"
```

---

## Task 5: Pass description/pairings through pricing

**Files:**
- Modify: `src/pricing.ts`

**Interfaces:**
- Consumes: `Decklist.description` (required), `Decklist.recommendedPairings` (optional) from Task 1.
- Produces: `priceDecklists` now returns `PricedDecklist` objects with `description` and
  `recommendedPairings` populated (previously these fields didn't exist on the return type).

- [x] **Step 1: Edit the first-pass mapping in `priceDecklists`**

In `src/pricing.ts`, change:

```ts
      deckTotal += categoryTotal;
      return { name: cat.name, cards, categoryTotal };
    });
    return { theme: decklist.theme, color: decklist.color ?? '', categories, deckTotal };
  });
```

to:

```ts
      deckTotal += categoryTotal;
      return { name: cat.name, cards, categoryTotal };
    });
    return {
      theme: decklist.theme,
      color: decklist.color ?? '',
      categories,
      deckTotal,
      description: decklist.description,
      recommendedPairings: decklist.recommendedPairings ?? [],
    };
  });
```

- [x] **Step 2: Type-check**

Run: `npx -y -p typescript tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext mtg-jumpstarts.ts`

Expected: no output, exit code 0 (confirmed by trial run) — the whole project type-checks clean again
at this point, even before Tasks 6 and 7. `mtg-jumpstarts.ts` and `src/output.ts` don't need the new
fields wired through yet to compile; Tasks 6/7 add the actual feature behavior on top of an
already-clean baseline.

- [x] **Step 3: Commit**

```bash
git add src/pricing.ts
git commit -m "Pass description and recommendedPairings through priceDecklists"
```

---

## Task 6: Wire orchestration in `mtg-jumpstarts.ts`

**Files:**
- Modify: `mtg-jumpstarts.ts`

**Interfaces:**
- Consumes: `analyzeSynergies`, `mergeRecommendedPairings` (Task 4, `src/agents.ts`); `Pairing` type
  (Task 1, `src/types.ts`).
- Produces: `pricedDecklists` passed to `printResults`/`exportCsv`/`exportXlsx` now carries
  `description` and `recommendedPairings` on every entry.

- [x] **Step 1: Update imports**

Change:

```ts
import {
  discoverThemes,
  isSamePageGrouped,
  extractDecklist,
  extractThemeFromPage,
} from './src/agents.js';
import { priceDecklists } from './src/pricing.js';
import { printResults, exportCsv, exportXlsx } from './src/output.js';
import type { Decklist } from './src/types.js';
```

to:

```ts
import {
  discoverThemes,
  isSamePageGrouped,
  extractDecklist,
  extractThemeFromPage,
  analyzeSynergies,
  mergeRecommendedPairings,
} from './src/agents.js';
import { priceDecklists } from './src/pricing.js';
import { printResults, exportCsv, exportXlsx } from './src/output.js';
import type { Decklist, Pairing } from './src/types.js';
```

- [x] **Step 2: Insert the synergy analysis step**

Change:

```ts
  // Attach color from theme discovery: match on exact name or numbered variant prefix
  // (e.g. Theme "Angels" → decklists "Angels 1", "Angels 2")
  const coloredDecklists: Decklist[] = decklists.map(d => {
    const match = themes.find(t => d.theme === t.name || d.theme.startsWith(t.name + ' '));
    return { ...d, color: match?.color ?? '' };
  });

  const pricedDecklists = await priceDecklists(coloredDecklists);
```

to:

```ts
  // Attach color from theme discovery: match on exact name or numbered variant prefix
  // (e.g. Theme "Angels" → decklists "Angels 1", "Angels 2")
  const coloredDecklists: Decklist[] = decklists.map(d => {
    const match = themes.find(t => d.theme === t.name || d.theme.startsWith(t.name + ' '));
    return { ...d, color: match?.color ?? '' };
  });

  // ── Phase 3: Cross-theme pairing recommendations ──────────────────────────
  console.error('\nAnalyzing cross-theme pairings...');
  const synergyInput = coloredDecklists.map(d => ({
    name: d.theme,
    color: d.color ?? '',
    description: d.description,
  }));
  const pairingsMap = await analyzeSynergies(client, semaphore, synergyInput).catch(err => {
    console.error(`  ✗ pairing analysis: ${err}`);
    return new Map<string, Pairing[]>();
  });
  const decklistsWithPairings = mergeRecommendedPairings(coloredDecklists, pairingsMap);

  const pricedDecklists = await priceDecklists(decklistsWithPairings);
```

- [x] **Step 3: Type-check**

Run: `npx -y -p typescript tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext mtg-jumpstarts.ts`

Expected: no output, exit code 0 (confirmed by trial run) — stays clean.

- [x] **Step 4: Do NOT commit**

Per Global Constraints, `mtg-jumpstarts.ts` already has pre-existing uncommitted XLSX-export changes.
Leave this file uncommitted (it now contains both that prior work and this task's new lines together)
and move on to Task 7.

---

## Task 7: Output formatting

**Files:**
- Modify: `src/output.ts`

**Interfaces:**
- Consumes: `PricedDecklist.description`, `PricedDecklist.recommendedPairings` (Task 1).

- [x] **Step 1: Add description + pairings to `printResults`**

Change:

```ts
    const countWarning = totalCards !== 20 ? ` ⚠ ${totalCards} cards (expected 20)` : '';
    console.log(`--- ${decklist.theme} ---${countWarning}`);

    for (const cat of decklist.categories) {
```

to:

```ts
    const countWarning = totalCards !== 20 ? ` ⚠ ${totalCards} cards (expected 20)` : '';
    console.log(`--- ${decklist.theme} ---${countWarning}`);
    console.log(decklist.description);
    if (decklist.recommendedPairings.length > 0) {
      const pairs = decklist.recommendedPairings.map(p => `${p.theme} (${p.reason})`).join(', ');
      console.log(`Pairs well with: ${pairs}`);
    }
    console.log('');

    for (const cat of decklist.categories) {
```

- [x] **Step 2: Add `Description` column to the XLSX summary sheet**

Change:

```ts
  const summaryHeader = ['Deck', 'Total ($)', 'Power (1-5)', 'Stars', ...ALL_TYPES.map(t => `${t} ($)`)];
  const summaryRows = decklists.map(deck => {
    const byType: Record<string, number> = {};
    for (const cat of deck.categories) {
      // match loosely (e.g. "Creatures" matches "Creatures (7 cards)")
      const key = ALL_TYPES.find(t => cat.name.startsWith(t)) ?? cat.name;
      byType[key] = (byType[key] ?? 0) + cat.categoryTotal;
    }
    return [
      deck.theme,
      fmt(deck.deckTotal),
      deck.powerTier,
      '★'.repeat(deck.powerTier) + '☆'.repeat(5 - deck.powerTier),
      ...ALL_TYPES.map(t => fmt(byType[t] ?? null)),
    ];
  });
```

to:

```ts
  const summaryHeader = ['Deck', 'Total ($)', 'Power (1-5)', 'Stars', 'Description', ...ALL_TYPES.map(t => `${t} ($)`)];
  const summaryRows = decklists.map(deck => {
    const byType: Record<string, number> = {};
    for (const cat of deck.categories) {
      // match loosely (e.g. "Creatures" matches "Creatures (7 cards)")
      const key = ALL_TYPES.find(t => cat.name.startsWith(t)) ?? cat.name;
      byType[key] = (byType[key] ?? 0) + cat.categoryTotal;
    }
    return [
      deck.theme,
      fmt(deck.deckTotal),
      deck.powerTier,
      '★'.repeat(deck.powerTier) + '☆'.repeat(5 - deck.powerTier),
      deck.description,
      ...ALL_TYPES.map(t => fmt(byType[t] ?? null)),
    ];
  });
```

- [x] **Step 3: Add a "Pairings" sheet**

Change:

```ts
  const cardsSheet = XLSX.utils.aoa_to_sheet([cardsHeader, ...cardsRows]);
  cardsSheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: cardsHeader.length - 1 })}` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, cardsSheet, 'Cards');
  XLSX.writeFile(wb, filepath);
  console.error(`Exported ${decklists.length} decks to ${filepath}`);
}
```

to:

```ts
  const cardsSheet = XLSX.utils.aoa_to_sheet([cardsHeader, ...cardsRows]);
  cardsSheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: cardsHeader.length - 1 })}` };

  // ── Sheet 3: Pairings (one row per recommended pairing) ──────────────────────
  const pairingsHeader = ['Deck', 'Recommended Pairing', 'Why'];
  const pairingsRows: string[][] = [];
  for (const deck of decklists) {
    for (const pairing of deck.recommendedPairings) {
      pairingsRows.push([deck.theme, pairing.theme, pairing.reason]);
    }
  }

  const pairingsSheet = XLSX.utils.aoa_to_sheet([pairingsHeader, ...pairingsRows]);
  pairingsSheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: pairingsHeader.length - 1 })}` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, cardsSheet, 'Cards');
  XLSX.utils.book_append_sheet(wb, pairingsSheet, 'Pairings');
  XLSX.writeFile(wb, filepath);
  console.error(`Exported ${decklists.length} decks to ${filepath}`);
}
```

- [x] **Step 4: Type-check (should now be fully clean)**

Run: `npx -y -p typescript tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext mtg-jumpstarts.ts`

Expected: no output, exit code 0 — every file in the chain (`types.ts`, `tools.ts`, `claude.ts`,
`agents.ts`, `pricing.ts`, `mtg-jumpstarts.ts`, `output.ts`) now type-checks cleanly.

- [x] **Step 5: Do NOT commit**

Per Global Constraints, `src/output.ts` already has pre-existing uncommitted XLSX-export changes.
Leave this file uncommitted alongside `mtg-jumpstarts.ts`. At the end of the plan, tell the user both
files contain a mix of the prior uncommitted XLSX work and this task's new lines, and ask how they
want those committed (split or together) — don't decide unilaterally.

---

## Task 8: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run against a small real series**

Run: `npx tsx mtg-jumpstarts.ts "Foundations Jumpstart" --xlsx /private/tmp/claude-501/-Users-teodellamico-Code-mtg-jumpstarts/91545188-45d3-4a6f-9933-75425742eb9d/scratchpad/foundations-verify.xlsx`

(Requires `ANTHROPIC_API_KEY` to be set in the environment — same precondition the script already
enforces.)

Expected:
- Console output for every theme shows a non-empty description line right under the `--- Theme ---`
  header, and (for series with ≥2 themes) a `Pairs well with: ...` line listing 1-5 other theme names
  with reasons, before the category breakdown.
- No `recommendedPairings` referencing a theme name that isn't one of the other printed themes.
- The run completes and writes the XLSX file without throwing.

- [ ] **Step 2: Inspect the XLSX output**

Run: `npx tsx -e "
import * as XLSX from 'xlsx';
const wb = XLSX.readFile('/private/tmp/claude-501/-Users-teodellamico-Code-mtg-jumpstarts/91545188-45d3-4a6f-9933-75425742eb9d/scratchpad/foundations-verify.xlsx');
console.log(wb.SheetNames);
console.log(XLSX.utils.sheet_to_json(wb.Sheets['Summary'])[0]);
console.log(XLSX.utils.sheet_to_json(wb.Sheets['Pairings']).slice(0, 3));
"`

Expected: `wb.SheetNames` includes `'Summary'`, `'Cards'`, `'Pairings'`; the first Summary row object
has a non-empty `Description` field; the first few Pairings rows each have `Deck`, `Recommended
Pairing`, and `Why` populated.

- [ ] **Step 3: Report results to the user**

No commit for this task — it's a verification pass over already-committed code. If either check
fails, return to the relevant task above, fix, re-verify the affected task's type-check, and re-run
this task from Step 1.
