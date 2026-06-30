# Structured JSON Output + Color Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace formatted-text stdout output with structured JSON, normalize each deck's color to a 6-value enum, flatten cards into one array per deck, and rename `powerTier`→`powerLevel` / `recommendedPairings`→`synergies` (with color attached) throughout.

**Architecture:** Pure data-shape changes across the existing pipeline (`src/types.ts` → `src/tools.ts` → `src/agents.ts` → `src/pricing.ts` → `src/output.ts` → `mtg-jumpstarts.ts`). No new files, no new dependencies, no new CLI flags. The Claude extraction contracts (decklist/category extraction) are untouched; only the synergy tool's field name changes.

**Tech Stack:** TypeScript (no build step — run via `tsx`), `@anthropic-ai/sdk`, `xlsx`. No test framework exists in this repo; verification uses small throwaway fixture scripts run with `tsx` (deleted after use, never committed) plus `npx -y -p typescript tsc --noEmit` for type-checking (transient — does not modify `package.json`).

## Global Constraints

- No new CLI flags — JSON replaces default stdout output (per approved spec).
- No changes to Claude decklist/category extraction prompts or schemas — only `PAIRINGS_TOOL`'s `reason`→`reasoning` field rename.
- `Color` enum is exactly: `'white' | 'blue' | 'black' | 'red' | 'green' | 'multi'`. Unrecognized/empty/`'Other'` → `'multi'`.
- Card fields: `{ title, type, qty, unitPrice, lineTotal }`. Synergy fields: `{ title, color, reasoning }`.
- Keep CSV/XLSX exports working; CSV header `Power Tier`→`Power Level`; XLSX Pairings sheet→Synergies sheet with `Deck, Synergy, Color, Reasoning` columns. XLSX Summary sheet keeps today's visible columns as-is (no new Color column there — color already lives in CSV and the primary JSON output).
- Every fixture/verification script lives at the repo root as `verify-tmp.ts`, is run with `npx tsx verify-tmp.ts`, and is deleted (`rm verify-tmp.ts`) before moving to the next task — never committed.

---

### Task 1: `Color` type, `normalizeColor`, and updated type definitions

**Files:**
- Modify: `src/types.ts` (full rewrite, currently 19 lines)

**Interfaces:**
- Produces: `Color` type, `normalizeColor(raw: string): Color`, `AgentSynergy = { theme: string; reasoning: string }`, `Synergy = { title: string; color: Color; reasoning: string }`, `Decklist.synergies?: Synergy[]` (replaces `recommendedPairings?: Pairing[]`), `PricedCard = { title: string; type: string; qty: number; unitPrice: number | null; lineTotal: number | null }`, `PricedDecklist = { theme, color: Color, description, cards: PricedCard[], cardCount: number, deckTotal: number, powerLevel: number, synergies: Synergy[] }`.
- Removes: `Pairing`, `PricedCategory`.

- [ ] **Step 1: Write the failing verification script**

Create `verify-tmp.ts` at the repo root:

```ts
import { normalizeColor } from './src/types.js';

const cases: [string, string][] = [
  ['White', 'white'],
  ['blue', 'blue'],
  ['BLACK', 'black'],
  ['Red', 'red'],
  ['Green', 'green'],
  ['Other', 'multi'],
  ['', 'multi'],
  ['Purple', 'multi'],
];

let failed = false;
for (const [input, expected] of cases) {
  const actual = normalizeColor(input);
  if (actual !== expected) {
    console.error(`FAIL: normalizeColor(${JSON.stringify(input)}) = ${actual}, expected ${expected}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('normalizeColor: all cases passed');
```

- [ ] **Step 2: Run it to verify it fails (normalizeColor doesn't exist yet)**

Run: `npx tsx verify-tmp.ts`
Expected: error — `normalizeColor` is not exported from `./src/types.js` (current `src/types.ts` has no such export).

- [ ] **Step 3: Rewrite `src/types.ts`**

```ts
export type Color = 'white' | 'blue' | 'black' | 'red' | 'green' | 'multi';

const KNOWN_COLORS: Record<string, Color> = {
  white: 'white',
  blue: 'blue',
  black: 'black',
  red: 'red',
  green: 'green',
};

export function normalizeColor(raw: string): Color {
  return KNOWN_COLORS[raw.toLowerCase()] ?? 'multi';
}

export type Theme = { name: string; url: string; color: string };
export type Card = { qty: number; name: string };
export type Category = { name: string; cards: Card[] };
export type AgentSynergy = { theme: string; reasoning: string };
export type Synergy = { title: string; color: Color; reasoning: string };

export type Decklist = {
  theme: string;
  color?: string;
  categories: Category[];
  description: string;
  synergies?: Synergy[];
};

export type PricedCard = {
  title: string;
  type: string;
  qty: number;
  unitPrice: number | null;
  lineTotal: number | null;
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

- [ ] **Step 4: Run the verification script again**

Run: `npx tsx verify-tmp.ts`
Expected: `normalizeColor: all cases passed`

- [ ] **Step 5: Delete the scratch file**

Run: `rm verify-tmp.ts`

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Color enum, normalizeColor, and flattened card/synergy types"
```

(Note: this commit alone leaves `src/tools.ts`, `src/agents.ts`, `src/pricing.ts`, `src/output.ts`, `mtg-jumpstarts.ts` referencing now-removed types like `Pairing` and `PricedCategory` — that's expected and resolved by the following tasks. No type-check gate until Task 6.)

---

### Task 2: Rename `PAIRINGS_TOOL`'s `reason` field to `reasoning`

**Files:**
- Modify: `src/tools.ts:79-97` (the `PAIRINGS_TOOL` definition)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PAIRINGS_TOOL.input_schema.properties.pairings.items.properties.recommendations.items` now requires `{ theme, reasoning }` instead of `{ theme, reason }`.

- [ ] **Step 1: Edit `src/tools.ts`**

Find:

```ts
                properties: {
                  theme: { type: 'string', description: 'Name of the recommended pairing theme (must be from the provided list)' },
                  reason: { type: 'string', description: '1-2 sentences on why this pairs well with the main theme specifically' },
                },
                required: ['theme', 'reason'],
```

Replace with:

```ts
                properties: {
                  theme: { type: 'string', description: 'Name of the recommended pairing theme (must be from the provided list)' },
                  reasoning: { type: 'string', description: '1-2 sentences on why this pairs well with the main theme specifically' },
                },
                required: ['theme', 'reasoning'],
```

- [ ] **Step 2: Verify the edit landed correctly**

Run: `grep -n "reasoning" src/tools.ts`
Expected: one match inside `PAIRINGS_TOOL`, and `grep -n "'theme', 'reason'\]" src/tools.ts` (old string) returns nothing.

- [ ] **Step 3: Commit**

```bash
git add src/tools.ts
git commit -m "feat: rename PAIRINGS_TOOL reason field to reasoning"
```

---

### Task 3: `analyzeSynergies` + `mergeSynergies` in `src/agents.ts`

**Files:**
- Modify: `src/agents.ts:1-10` (imports), `src/agents.ts:178-223` (`analyzeSynergies` and `mergeRecommendedPairings`)

**Interfaces:**
- Consumes: `Color`, `normalizeColor`, `AgentSynergy`, `Synergy`, `Decklist` from `./types.js` (Task 1).
- Produces: `analyzeSynergies(...): Promise<Map<string, AgentSynergy[]>>` (unchanged signature shape, renamed return element type). `mergeSynergies(decklists: Decklist[], synergiesMap: Map<string, AgentSynergy[]>): Decklist[]` — replaces `mergeRecommendedPairings`; populates `Decklist.synergies: Synergy[]` (with `title`/`color`/`reasoning`), looking up each recommended theme's color from `decklists`.

- [ ] **Step 1: Write the failing verification script**

Create `verify-tmp.ts` at the repo root:

```ts
import { mergeSynergies } from './src/agents.js';
import type { Decklist, AgentSynergy } from './src/types.js';

const decklists: Decklist[] = [
  { theme: 'Aang', color: 'white', categories: [], description: 'd1' },
  { theme: 'Zuko', color: 'red', categories: [], description: 'd2' },
  { theme: 'Toph', color: 'green', categories: [], description: 'd3' },
];

const synergiesMap = new Map<string, AgentSynergy[]>([
  ['Aang', [
    { theme: 'Zuko', reasoning: 'fire and air combo' },
    { theme: 'Ghost Town', reasoning: 'hallucinated, not in series' },
  ]],
]);

const merged = mergeSynergies(decklists, synergiesMap);
const aang = merged.find(d => d.theme === 'Aang')!;

let failed = false;
if (aang.synergies?.length !== 1) { console.error(`FAIL: expected 1 synergy, got ${aang.synergies?.length}`); failed = true; }
const s = aang.synergies?.[0];
if (s?.title !== 'Zuko') { console.error(`FAIL: title = ${s?.title}, expected Zuko`); failed = true; }
if (s?.color !== 'red') { console.error(`FAIL: color = ${s?.color}, expected red`); failed = true; }
if (s?.reasoning !== 'fire and air combo') { console.error(`FAIL: reasoning mismatch`); failed = true; }

const zuko = merged.find(d => d.theme === 'Zuko')!;
if (zuko.synergies?.length !== 0) { console.error(`FAIL: Zuko should have 0 synergies, got ${zuko.synergies?.length}`); failed = true; }

if (failed) process.exit(1);
console.log('mergeSynergies: all cases passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx verify-tmp.ts`
Expected: error — `mergeSynergies` is not exported from `./src/agents.js` (current file only exports `mergeRecommendedPairings`).

- [ ] **Step 3: Update the import line at the top of `src/agents.ts`**

Find:

```ts
import type { Theme, Decklist, Pairing } from './types.js';
```

Replace with:

```ts
import type { Theme, Decklist, AgentSynergy, Synergy } from './types.js';
import { normalizeColor } from './types.js';
```

- [ ] **Step 4: Replace `analyzeSynergies`'s return type**

Find (in the `analyzeSynergies` function, `src/agents.ts:178-210`):

```ts
export async function analyzeSynergies(
  client: Anthropic,
  semaphore: Semaphore,
  themes: { name: string; color: string; description: string }[],
): Promise<Map<string, Pairing[]>> {
```

Replace with:

```ts
export async function analyzeSynergies(
  client: Anthropic,
  semaphore: Semaphore,
  themes: { name: string; color: string; description: string }[],
): Promise<Map<string, AgentSynergy[]>> {
```

Find (further down in the same function):

```ts
  const result = await withRetry(
    () => callAgent<{ pairings: { theme: string; recommendations: Pairing[] }[] }>(
      client, semaphore, PAIRINGS_TOOL, instructions, content, 32000, 'claude-sonnet-5',
    ),
    'pairing analysis',
  );
```

Replace with:

```ts
  const result = await withRetry(
    () => callAgent<{ pairings: { theme: string; recommendations: AgentSynergy[] }[] }>(
      client, semaphore, PAIRINGS_TOOL, instructions, content, 32000, 'claude-sonnet-5',
    ),
    'pairing analysis',
  );
```

- [ ] **Step 5: Replace `mergeRecommendedPairings` with `mergeSynergies`**

Find (`src/agents.ts:212-223`):

```ts
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

Replace with:

```ts
// Defensive merge: drop any recommended theme name that doesn't actually exist in this
// series (handles model hallucination without a retry). Looks up each recommended
// theme's own color so the final Synergy carries {title, color, reasoning}.
export function mergeSynergies(
  decklists: Decklist[],
  synergiesMap: Map<string, AgentSynergy[]>,
): Decklist[] {
  const colorByTheme = new Map(decklists.map(d => [d.theme, normalizeColor(d.color ?? '')]));
  return decklists.map(d => ({
    ...d,
    synergies: (synergiesMap.get(d.theme) ?? [])
      .filter(s => colorByTheme.has(s.theme))
      .map((s): Synergy => ({ title: s.theme, color: colorByTheme.get(s.theme)!, reasoning: s.reasoning })),
  }));
}
```

- [ ] **Step 6: Run the verification script again**

Run: `npx tsx verify-tmp.ts`
Expected: `mergeSynergies: all cases passed`

- [ ] **Step 7: Delete the scratch file**

Run: `rm verify-tmp.ts`

- [ ] **Step 8: Commit**

```bash
git add src/agents.ts
git commit -m "feat: rename mergeRecommendedPairings to mergeSynergies, attach color"
```

---

### Task 4: Flatten cards and rename `powerTier`→`powerLevel` in `src/pricing.ts`

**Files:**
- Modify: `src/pricing.ts` (full rewrite, currently 53 lines)

**Interfaces:**
- Consumes: `Decklist`, `PricedDecklist`, `PricedCard`, `normalizeColor` from `./types.js` (Task 1).
- Produces: `priceDecklists(decklists: Decklist[]): Promise<PricedDecklist[]>` — same exported name/signature, new flattened output shape (`cards`, `cardCount`, `powerLevel`, `synergies` carried through from `Decklist.synergies`).

- [ ] **Step 1: Write the failing verification script**

This hits the real Scryfall API (network access confirmed available; no API key needed for Scryfall).

Create `verify-tmp.ts` at the repo root:

```ts
import { priceDecklists } from './src/pricing.js';
import type { Decklist } from './src/types.js';

const decklists: Decklist[] = [
  {
    theme: 'Test Deck',
    color: 'red',
    description: 'a test deck',
    categories: [
      { name: 'Instants', cards: [{ qty: 1, name: 'Lightning Bolt' }] },
      { name: 'Creatures', cards: [{ qty: 2, name: 'Goblin Guide' }] },
    ],
    synergies: [{ title: 'Other Deck', color: 'blue', reasoning: 'pairs well' }],
  },
];

const [priced] = await priceDecklists(decklists);

let failed = false;
if (priced.cards.length !== 2) { console.error(`FAIL: expected 2 flat cards, got ${priced.cards.length}`); failed = true; }
const bolt = priced.cards.find(c => c.title === 'Lightning Bolt');
if (!bolt) { console.error('FAIL: Lightning Bolt missing from flat cards'); failed = true; }
else {
  if (bolt.type !== 'Instants') { console.error(`FAIL: bolt.type = ${bolt.type}, expected Instants`); failed = true; }
  if (bolt.qty !== 1) { console.error(`FAIL: bolt.qty = ${bolt.qty}`); failed = true; }
  if (typeof bolt.unitPrice !== 'number') { console.error(`FAIL: bolt.unitPrice not a number: ${bolt.unitPrice}`); failed = true; }
  if (bolt.lineTotal !== bolt.unitPrice) { console.error(`FAIL: lineTotal should equal unitPrice * 1`); failed = true; }
}
if (priced.cardCount !== 3) { console.error(`FAIL: cardCount = ${priced.cardCount}, expected 3`); failed = true; }
if (priced.color !== 'red') { console.error(`FAIL: color = ${priced.color}, expected red`); failed = true; }
if (typeof priced.powerLevel !== 'number') { console.error('FAIL: powerLevel missing'); failed = true; }
if (priced.synergies.length !== 1 || priced.synergies[0].title !== 'Other Deck') { console.error('FAIL: synergies not carried through'); failed = true; }
// @ts-expect-error categories should no longer exist on PricedDecklist
if ('categories' in priced) { console.error('FAIL: categories should not exist on PricedDecklist'); failed = true; }

if (failed) process.exit(1);
console.log('priceDecklists: all cases passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx verify-tmp.ts`
Expected: error — current `priceDecklists` returns `categories`/`recommendedPairings`/`powerTier`, not `cards`/`cardCount`/`powerLevel`/`synergies` — assertions fail (or TS errors on the `@ts-expect-error` line not matching, since `categories` still exists). Either failure mode is acceptable proof the old code doesn't satisfy the new shape.

- [ ] **Step 3: Rewrite `src/pricing.ts`**

```ts
// Attaches Scryfall USD prices to extracted decklists, flattens cards into one
// array per deck, and assigns power levels. Power level is 1–5 stars, distributed
// on a z-score bell curve relative to the mean deck value of the series: most
// decks land at 3, true outliers at 1 or 5.

import type { Decklist, PricedDecklist, PricedCard } from './types.js';
import { normalizeColor } from './types.js';
import { fetchScryfallPrices } from './scryfall.js';

function zScoreTier(z: number): number {
  if (z < -1.5) return 1;
  if (z < -0.5) return 2;
  if (z < 0.5)  return 3;
  if (z < 1.5)  return 4;
  return 5;
}

export async function priceDecklists(decklists: Decklist[]): Promise<PricedDecklist[]> {
  const allNames = [...new Set(
    decklists.flatMap(d => d.categories.flatMap(cat => cat.cards.map(c => c.name)))
  )];

  console.error(`Looking up prices for ${allNames.length} unique cards via Scryfall...`);
  const priceMap = await fetchScryfallPrices(allNames);

  // First pass: flatten categories into cards, price each deck
  const priced = decklists.map(decklist => {
    let deckTotal = 0;
    let cardCount = 0;
    const cards: PricedCard[] = decklist.categories.flatMap(cat =>
      cat.cards.map(card => {
        const unitPrice = priceMap.get(card.name) ?? null;
        const lineTotal = unitPrice !== null ? unitPrice * card.qty : null;
        if (lineTotal !== null) deckTotal += lineTotal;
        cardCount += card.qty;
        return { title: card.name, type: cat.name, qty: card.qty, unitPrice, lineTotal };
      }),
    );

    if (cardCount !== 20) {
      console.error(`  ⚠ ${decklist.theme}: ${cardCount} cards (expected 20)`);
    }

    return {
      theme: decklist.theme,
      color: normalizeColor(decklist.color ?? ''),
      description: decklist.description,
      cards,
      cardCount,
      deckTotal,
      synergies: decklist.synergies ?? [],
    };
  });

  // Second pass: z-score power levels relative to this series
  const totals = priced.map(d => d.deckTotal);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const stdDev = Math.sqrt(totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length);

  return priced.map(d => ({
    ...d,
    powerLevel: stdDev === 0 ? 3 : zScoreTier((d.deckTotal - mean) / stdDev),
  }));
}
```

- [ ] **Step 4: Run the verification script again**

Run: `npx tsx verify-tmp.ts`
Expected: `priceDecklists: all cases passed`

- [ ] **Step 5: Delete the scratch file**

Run: `rm verify-tmp.ts`

- [ ] **Step 6: Commit**

```bash
git add src/pricing.ts
git commit -m "feat: flatten cards in priceDecklists, rename powerTier to powerLevel"
```

---

### Task 5: `src/output.ts` — JSON printer + CSV/XLSX updates

**Files:**
- Modify: `src/output.ts` (full rewrite, currently 157 lines)

**Interfaces:**
- Consumes: `PricedDecklist`, `PricedCard`, `Synergy` from `./types.js`.
- Produces: `printResultsJson(keyword: string, decklists: PricedDecklist[]): void` (replaces `printResults`). `exportCsv`/`exportXlsx` keep their exact exported signatures, updated internals.
- Removes: `printResults`, the unused `stars()` helper.

- [ ] **Step 1: Write the failing verification script**

Create `verify-tmp.ts` at the repo root:

```ts
import { printResultsJson, exportCsv, exportXlsx } from './src/output.js';
import type { PricedDecklist } from './src/types.js';
import { readFileSync, unlinkSync } from 'node:fs';

const decklists: PricedDecklist[] = [
  {
    theme: 'Aang',
    color: 'white',
    description: 'airbending tempo',
    cards: [
      { title: 'Aang, Airbending Master', type: 'Creatures', qty: 1, unitPrice: 8.24, lineTotal: 8.24 },
      { title: 'Gust', type: 'Instants', qty: 1, unitPrice: 0.10, lineTotal: 0.10 },
    ],
    cardCount: 2,
    deckTotal: 8.34,
    powerLevel: 3,
    synergies: [{ title: 'Zuko', color: 'red', reasoning: 'fire and air combo' }],
  },
];

let failed = false;

// 1. JSON printer: capture stdout
const originalLog = console.log;
let captured = '';
console.log = (s: string) => { captured += s; };
printResultsJson('Avatar', decklists);
console.log = originalLog;

const parsed = JSON.parse(captured);
if (parsed.series !== 'Avatar') { console.error('FAIL: series mismatch'); failed = true; }
if (parsed.themeCount !== 1) { console.error('FAIL: themeCount mismatch'); failed = true; }
if (parsed.decks[0].cards[0].title !== 'Aang, Airbending Master') { console.error('FAIL: card title missing'); failed = true; }
if (parsed.decks[0].synergies[0].title !== 'Zuko') { console.error('FAIL: synergy title missing'); failed = true; }
if (parsed.decks[0].powerLevel !== 3) { console.error('FAIL: powerLevel missing'); failed = true; }

// 2. CSV export
exportCsv('Avatar', decklists, '/tmp/verify-test.csv');
const csv = readFileSync('/tmp/verify-test.csv', 'utf8');
if (!csv.includes('Power Level')) { console.error('FAIL: CSV header missing Power Level'); failed = true; }
if (!csv.includes('Aang, Airbending Master')) { console.error('FAIL: CSV missing card row'); failed = true; }
unlinkSync('/tmp/verify-test.csv');

// 3. XLSX export (just confirm it runs without throwing and writes a file)
exportXlsx('Avatar', decklists, '/tmp/verify-test.xlsx');
import { statSync } from 'node:fs';
if (statSync('/tmp/verify-test.xlsx').size === 0) { console.error('FAIL: XLSX file is empty'); failed = true; }
unlinkSync('/tmp/verify-test.xlsx');

if (failed) process.exit(1);
console.log('output.ts: all cases passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx verify-tmp.ts`
Expected: error — `printResultsJson` is not exported from `./src/output.js` (current file only exports `printResults`).

- [ ] **Step 3: Rewrite `src/output.ts`**

```ts
// Formats and prints results to stdout. Progress messages go to stderr
// so that stdout remains clean (pipeable to jq, files, etc.).

import { writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type { PricedDecklist } from './types.js';

export function printResultsJson(keyword: string, decklists: PricedDecklist[]): void {
  console.log(JSON.stringify({ series: keyword, themeCount: decklists.length, decks: decklists }, null, 2));
}

export function exportCsv(keyword: string, decklists: PricedDecklist[], filepath: string): void {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

  const rows: string[] = [
    ['Series', 'Theme', 'Color', 'Type', 'Qty', 'Card', 'Unit Price', 'Line Total', 'Deck Total', 'Power Level']
      .map(esc).join(','),
  ];

  for (const deck of decklists) {
    for (const card of deck.cards) {
      rows.push([
        keyword,
        deck.theme,
        deck.color,
        card.type,
        card.qty,
        card.title,
        card.unitPrice !== null ? card.unitPrice.toFixed(2) : '',
        card.lineTotal !== null ? card.lineTotal.toFixed(2) : '',
        deck.deckTotal.toFixed(2),
        deck.powerLevel,
      ].map(esc).join(','));
    }
  }

  writeFileSync(filepath, rows.join('\n'), 'utf8');
  console.error(`Exported ${decklists.length} decks to ${filepath}`);
}

export function exportXlsx(keyword: string, decklists: PricedDecklist[], filepath: string): void {
  const fmt = (n: number | null) => n !== null ? parseFloat(n.toFixed(2)) : null;

  // ── Sheet 1: Summary (one row per deck) ──────────────────────────────────────
  const ALL_TYPES = ['Creatures', 'Instants', 'Sorceries', 'Enchantments', 'Artifacts', 'Lands'];

  const summaryHeader = ['Deck', 'Total ($)', 'Power (1-5)', 'Stars', 'Description', ...ALL_TYPES.map(t => `${t} ($)`)];
  const summaryRows = decklists.map(deck => {
    const byType: Record<string, number> = {};
    for (const card of deck.cards) {
      if (card.lineTotal === null) continue;
      // match loosely (e.g. "Creatures" matches "Creatures (7 cards)")
      const key = ALL_TYPES.find(t => card.type.startsWith(t)) ?? card.type;
      byType[key] = (byType[key] ?? 0) + card.lineTotal;
    }
    return [
      deck.theme,
      fmt(deck.deckTotal),
      deck.powerLevel,
      '★'.repeat(deck.powerLevel) + '☆'.repeat(5 - deck.powerLevel),
      deck.description,
      ...ALL_TYPES.map(t => fmt(byType[t] ?? null)),
    ];
  });

  const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
  summarySheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: summaryHeader.length - 1 })}` };

  // ── Sheet 2: Cards (one row per card) ─────────────────────────────────────────
  const cardsHeader = ['Series', 'Deck', 'Type', 'Card', 'Qty', 'Unit ($)', 'Line Total ($)', 'Deck Total ($)', 'Power (1-5)'];
  const cardsRows: (string | number | null)[][] = decklists.flatMap(deck =>
    deck.cards.map(card => [
      keyword,
      deck.theme,
      card.type,
      card.title,
      card.qty,
      fmt(card.unitPrice),
      fmt(card.lineTotal),
      fmt(deck.deckTotal),
      deck.powerLevel,
    ]),
  );

  const cardsSheet = XLSX.utils.aoa_to_sheet([cardsHeader, ...cardsRows]);
  cardsSheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: cardsHeader.length - 1 })}` };

  // ── Sheet 3: Synergies (one row per recommended synergy) ─────────────────────
  const synergiesHeader = ['Deck', 'Synergy', 'Color', 'Reasoning'];
  const synergiesRows: string[][] = [];
  for (const deck of decklists) {
    for (const synergy of deck.synergies) {
      synergiesRows.push([deck.theme, synergy.title, synergy.color, synergy.reasoning]);
    }
  }

  const synergiesSheet = XLSX.utils.aoa_to_sheet([synergiesHeader, ...synergiesRows]);
  synergiesSheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: synergiesHeader.length - 1 })}` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, cardsSheet, 'Cards');
  XLSX.utils.book_append_sheet(wb, synergiesSheet, 'Synergies');
  XLSX.writeFile(wb, filepath);
  console.error(`Exported ${decklists.length} decks to ${filepath}`);
}
```

- [ ] **Step 4: Run the verification script again**

Run: `npx tsx verify-tmp.ts`
Expected: `output.ts: all cases passed`

- [ ] **Step 5: Delete the scratch file**

Run: `rm verify-tmp.ts`

- [ ] **Step 6: Commit**

```bash
git add src/output.ts
git commit -m "feat: replace printResults with JSON output, update CSV/XLSX to flat cards"
```

---

### Task 6: Wire it all together in `mtg-jumpstarts.ts`

**Files:**
- Modify: `mtg-jumpstarts.ts:18-33` (imports), `mtg-jumpstarts.ts:139-160` (color attach, synergy merge, final print)

**Interfaces:**
- Consumes: `mergeSynergies`, `normalizeColor`, `printResultsJson`, `AgentSynergy` (all from prior tasks).

- [ ] **Step 1: Update imports**

Find (`mtg-jumpstarts.ts:23-33`):

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

Replace with:

```ts
import {
  discoverThemes,
  isSamePageGrouped,
  extractDecklist,
  extractThemeFromPage,
  analyzeSynergies,
  mergeSynergies,
} from './src/agents.js';
import { priceDecklists } from './src/pricing.js';
import { printResultsJson, exportCsv, exportXlsx } from './src/output.js';
import type { Decklist, AgentSynergy } from './src/types.js';
import { normalizeColor } from './src/types.js';
```

- [ ] **Step 2: Apply `normalizeColor` at the color-attach step**

Find (`mtg-jumpstarts.ts:139-142`):

```ts
  const coloredDecklists: Decklist[] = decklists.map(d => {
    const match = themes.find(t => d.theme === t.name || d.theme.startsWith(t.name + ' '));
    return { ...d, color: match?.color ?? '' };
  });
```

Replace with:

```ts
  const coloredDecklists: Decklist[] = decklists.map(d => {
    const match = themes.find(t => d.theme === t.name || d.theme.startsWith(t.name + ' '));
    return { ...d, color: normalizeColor(match?.color ?? '') };
  });
```

- [ ] **Step 3: Wire `mergeSynergies` and `printResultsJson`**

Find (`mtg-jumpstarts.ts:144-160`):

```ts
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
  printResults(keyword, pricedDecklists);
  if (csvPath) exportCsv(keyword, pricedDecklists, csvPath);
  if (xlsxPath) exportXlsx(keyword, pricedDecklists, xlsxPath);
```

Replace with:

```ts
  // ── Phase 3: Cross-theme synergy recommendations ───────────────────────────
  console.error('\nAnalyzing cross-theme synergies...');
  const synergyInput = coloredDecklists.map(d => ({
    name: d.theme,
    color: d.color ?? '',
    description: d.description,
  }));
  const synergiesMap = await analyzeSynergies(client, semaphore, synergyInput).catch(err => {
    console.error(`  ✗ synergy analysis: ${err}`);
    return new Map<string, AgentSynergy[]>();
  });
  const decklistsWithSynergies = mergeSynergies(coloredDecklists, synergiesMap);

  const pricedDecklists = await priceDecklists(decklistsWithSynergies);
  printResultsJson(keyword, pricedDecklists);
  if (csvPath) exportCsv(keyword, pricedDecklists, csvPath);
  if (xlsxPath) exportXlsx(keyword, pricedDecklists, xlsxPath);
```

- [ ] **Step 4: Type-check the whole project**

Run:
```bash
npx -y -p typescript tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext mtg-jumpstarts.ts
```
Expected: no output (success). This is the first point where every file in the pipeline is wired together, so it's the real cross-file consistency gate — fix any reported type errors before proceeding.

- [ ] **Step 5: End-to-end fixture run (no network/API key required for this step — pure pipe-through)**

Create `verify-tmp.ts` at the repo root:

```ts
import { mergeSynergies } from './src/agents.js';
import { priceDecklists } from './src/pricing.js';
import { printResultsJson } from './src/output.js';
import { normalizeColor } from './src/types.js';
import type { Decklist, AgentSynergy } from './src/types.js';

const raw: Decklist[] = [
  {
    theme: 'Aang',
    color: normalizeColor('White'),
    description: 'airbending tempo',
    categories: [
      { name: 'Creatures', cards: [{ qty: 1, name: 'Lightning Bolt' }] },
    ],
  },
  {
    theme: 'Zuko',
    color: normalizeColor('Red'),
    description: 'firebending aggro',
    categories: [
      { name: 'Creatures', cards: [{ qty: 1, name: 'Goblin Guide' }] },
    ],
  },
];

const synergiesMap = new Map<string, AgentSynergy[]>([
  ['Aang', [{ theme: 'Zuko', reasoning: 'fire and air combo' }]],
]);

const merged = mergeSynergies(raw, synergiesMap);
const priced = await priceDecklists(merged);
printResultsJson('Avatar Test', priced);
```

Run: `npx tsx verify-tmp.ts | tee /tmp/verify-output.json | npx -y -p typescript node -e "JSON.parse(require('fs').readFileSync('/tmp/verify-output.json','utf8')); console.log('valid JSON')"`

Expected: prints the full JSON object, then `valid JSON`. Spot-check by eye: `decks[0].color` is `"white"`, `decks[0].synergies[0]` is `{title:"Zuko", color:"red", reasoning:"fire and air combo"}`, `decks[0].cards[0].title` is `"Lightning Bolt"`.

- [ ] **Step 6: Delete the scratch file**

Run: `rm verify-tmp.ts`

- [ ] **Step 7: Commit**

```bash
git add mtg-jumpstarts.ts
git commit -m "feat: wire normalized color, mergeSynergies, and JSON output into main pipeline"
```

---

### Task 7: Update `README.md`

**Files:**
- Modify: `README.md:44-78` (Output section and CSV export section)

- [ ] **Step 1: Replace the "Output" section**

Find (`README.md:44-57`):

```markdown
## Output

```
=== AVATAR LAST AIRBENDER JUMPSTART ===
Found 66 themes.

--- Aang ---
Creatures (8 cards)  $9.47
  1x Aang, Airbending Master  $8.24 ea  $8.24
  ...
[20 cards total | Deck value: $11.56 | Power: ★★★☆☆ (3/5)]
```

Power is rated **1–5 stars** on a z-score bell curve relative to the series mean — most decks land at 3★, true outliers at 1★ or 5★.
```

Replace with:

```markdown
## Output

Results print as structured JSON to stdout (progress goes to stderr):

```json
{
  "series": "Avatar: The Last Airbender",
  "themeCount": 66,
  "decks": [
    {
      "theme": "Aang",
      "color": "white",
      "description": "Airbending tempo deck built around evasive creatures and tactical disruption.",
      "cards": [
        { "title": "Aang, Airbending Master", "type": "Creatures", "qty": 1, "unitPrice": 8.24, "lineTotal": 8.24 }
      ],
      "cardCount": 20,
      "deckTotal": 11.56,
      "powerLevel": 3,
      "synergies": [
        { "title": "Zuko", "color": "red", "reasoning": "Firebending aggro pairs well with Aang's evasive tempo, balancing curve and removal." }
      ]
    }
  ]
}
```

- **`color`** — one of `white` / `blue` / `black` / `red` / `green` / `multi`
- **`powerLevel`** — rated **1–5** on a z-score bell curve relative to the series mean — most decks land at 3, true outliers at 1 or 5
- A deck with a card count other than 20 logs a `⚠` warning to stderr (not stdout) during processing
```

- [ ] **Step 2: Update the CSV export column docs**

Find (`README.md:67-76`):

```markdown
One row per card. Columns:

| Series | Theme | Color | Type | Qty | Card | Unit Price | Line Total | Deck Total | Power Tier |
|--------|-------|-------|------|-----|------|------------|------------|------------|------------|
| Avatar: The Last Airbender | Aang | White | Creatures | 1 | Aang, Airbending Master | 8.24 | 8.24 | 11.56 | 3 |

- **Color** — `White` / `Blue` / `Black` / `Red` / `Green` / `Other`
- **Power Tier** — raw number 1–5 (sortable/filterable in Sheets)
- Prices are bare numbers (no `$`) so spreadsheet formulas work
- Cards with unknown prices have empty price cells
```

Replace with:

```markdown
One row per card. Columns:

| Series | Theme | Color | Type | Qty | Card | Unit Price | Line Total | Deck Total | Power Level |
|--------|-------|-------|------|-----|------|------------|------------|------------|-------------|
| Avatar: The Last Airbender | Aang | white | Creatures | 1 | Aang, Airbending Master | 8.24 | 8.24 | 11.56 | 3 |

- **Color** — `white` / `blue` / `black` / `red` / `green` / `multi`
- **Power Level** — raw number 1–5 (sortable/filterable in Sheets)
- Prices are bare numbers (no `$`) so spreadsheet formulas work
- Cards with unknown prices have empty price cells
```

- [ ] **Step 3: Verify the doc renders sensibly**

Run: `grep -n "Power Tier\|recommendedPairings\|categories" README.md`
Expected: no matches (all stale references removed).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for JSON output and color/power-level renames"
```

---

### Task 8: Full pipeline smoke check

**Files:** none modified — verification only.

- [ ] **Step 1: Confirm no stale references remain anywhere in source**

Run: `grep -rn "powerTier\|recommendedPairings\|PricedCategory\|printResults\b\|mergeRecommendedPairings\|: Pairing\b" mtg-jumpstarts.ts src/ README.md`
Expected: no matches. (`printResultsJson` and `Pairing`-free `AgentSynergy`/`Synergy` are fine; this grep specifically targets the old names.)

- [ ] **Step 2: Re-run the full-project type-check**

Run:
```bash
npx -y -p typescript tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext mtg-jumpstarts.ts
```
Expected: no output (success).

- [ ] **Step 3: Manually note the live-run gap**

This repo has no `ANTHROPIC_API_KEY` configured in this environment, so `discoverThemes`/`extractDecklist`/`extractThemeFromPage`/`analyzeSynergies` (the Claude-calling functions) cannot be exercised end-to-end here. Tasks 1–6 verified every pure transformation (`normalizeColor`, `mergeSynergies`, `priceDecklists`, `output.ts`) with real or fixture data, and Task 6 Step 5 verified the full non-Claude half of the pipeline (merge → price → print) produces valid, correctly-shaped JSON. Before relying on this in production, run a real series once `ANTHROPIC_API_KEY` is set, e.g.:

```bash
npx tsx mtg-jumpstarts.ts "Foundations Jumpstart" | jq .
```

and confirm `jq` parses it and a couple of decks look right by eye.

- [ ] **Step 4: No commit needed for this task** (verification only).
