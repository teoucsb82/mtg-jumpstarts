# MTG Jumpstart Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI script that takes a Jumpstart series keyword, discovers all themes via Claude Haiku + mtg.wiki, extracts each 20-card decklist, looks up Scryfall prices, and prints a formatted report with card costs and a deck power summary.

**Architecture:** Two-phase Claude orchestration. Phase 1: fetch series wiki page → Haiku agent extracts theme list. Phase 2: parallel fetch each theme page → Haiku agent per theme extracts decklist. After agents finish, Scryfall collection API batches price lookups. All output goes to stdout; progress messages go to stderr.

**Tech Stack:** TypeScript, tsx, @anthropic-ai/sdk, Node.js built-in `fetch`, Scryfall REST API (no auth), mtg.wiki (HTML scraping).

## Global Constraints

- Run with: `npx tsx mtg-jumpstarts.ts "<keyword>"`
- Requires `ANTHROPIC_API_KEY` env var (checked at startup)
- Claude model: `claude-haiku-4-5-20251001`
- No new npm packages — only `@anthropic-ai/sdk` (already installed) and Node built-ins
- Scryfall API rate limit: 10 req/sec — batch card lookups in groups of ≤75, add 100ms delay between batches
- All types exported so test file can import them
- Entry point guard: only call `main()` when file is run directly (not imported by tests)
- Progress/debug output goes to `console.error`; final formatted report goes to `console.log`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Add `"type": "module"` and `"test"` script |
| `mtg-jumpstarts.ts` | Create | All implementation: types, utilities, Claude agents, Scryfall lookup, output, main |
| `mtg-jumpstarts.test.ts` | Create | Unit tests for pure functions: `stripHtml`, `extractJson`, `buildSeriesUrl`, `printResults` |

---

### Task 1: Project scaffolding + type definitions

**Files:**
- Modify: `package.json`
- Create: `mtg-jumpstarts.ts`
- Create: `mtg-jumpstarts.test.ts`

**Interfaces:**
- Produces: `Theme`, `Card`, `Category`, `PricedCard`, `PricedCategory`, `Decklist`, `PricedDecklist` types imported by later tasks

- [ ] **Step 1: Update package.json**

Replace the entire file with:

```json
{
  "type": "module",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.107.0"
  },
  "scripts": {
    "test": "node --import tsx --test mtg-jumpstarts.test.ts"
  }
}
```

- [ ] **Step 2: Create mtg-jumpstarts.ts skeleton with all types**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'node:url';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Theme = { name: string; url: string };
export type Card = { qty: number; name: string };
export type Category = { name: string; cards: Card[] };
export type Decklist = { theme: string; categories: Category[] };

export type PricedCard = Card & { unitPrice: number | null };
export type PricedCategory = { name: string; cards: PricedCard[]; categoryTotal: number };
export type PricedDecklist = {
  theme: string;
  categories: PricedCategory[];
  deckTotal: number;
  powerTier: 'Budget' | 'Mid' | 'Premium';
};

// ─── Placeholder exports (filled in subsequent tasks) ─────────────────────────

export function stripHtml(_raw: string): string { throw new Error('not implemented'); }
export function extractJson(_text: string): string { throw new Error('not implemented'); }
export function buildSeriesUrl(_keyword: string): string { throw new Error('not implemented'); }
export function printResults(_keyword: string, _decklists: PricedDecklist[]): void { throw new Error('not implemented'); }

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  throw new Error('not implemented');
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch(err => { console.error(`Fatal: ${err.message}`); process.exit(1); });
}
```

- [ ] **Step 3: Create mtg-jumpstarts.test.ts skeleton**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, extractJson, buildSeriesUrl, printResults } from './mtg-jumpstarts.ts';
```

- [ ] **Step 4: Run tests to confirm setup works (0 tests, no errors)**

```bash
node --import tsx --test mtg-jumpstarts.test.ts
```

Expected: `▶ (no tests)` or empty output with exit code 0. If you see `ERR_MODULE_NOT_FOUND`, check `"type": "module"` is in package.json.

- [ ] **Step 5: Commit**

```bash
git init && git add package.json mtg-jumpstarts.ts mtg-jumpstarts.test.ts
git commit -m "feat: project scaffold with types"
```

---

### Task 2: HTML utilities — stripHtml and extractJson

**Files:**
- Modify: `mtg-jumpstarts.ts`
- Modify: `mtg-jumpstarts.test.ts`

**Interfaces:**
- Produces: `stripHtml(raw: string): string`, `extractJson(text: string): string`
- Consumes: nothing

- [ ] **Step 1: Write failing tests for stripHtml**

Add to `mtg-jumpstarts.test.ts`:

```typescript
test('stripHtml removes script tags and their content', () => {
  const html = '<html><head><script>alert("xss")</script></head><body><p>Hello</p></body></html>';
  const result = stripHtml(html);
  assert.ok(!result.includes('alert'), 'script content should be removed');
  assert.ok(result.includes('Hello'), 'body text should be preserved');
});

test('stripHtml removes style tags and their content', () => {
  const html = '<html><head><style>body { color: red; }</style></head><body>World</body></html>';
  const result = stripHtml(html);
  assert.ok(!result.includes('color: red'), 'style content should be removed');
  assert.ok(result.includes('World'));
});

test('stripHtml removes HTML comments', () => {
  const result = stripHtml('<!-- comment --><p>Text</p>');
  assert.ok(!result.includes('comment'));
  assert.ok(result.includes('Text'));
});

test('stripHtml collapses excessive whitespace', () => {
  const result = stripHtml('<p>One</p>   \n\n\n   <p>Two</p>');
  assert.ok(!result.includes('\n\n\n'), 'multiple blank lines should collapse');
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --import tsx --test mtg-jumpstarts.test.ts
```

Expected: 4 failures with `Error: not implemented`

- [ ] **Step 3: Implement stripHtml in mtg-jumpstarts.ts**

Replace the placeholder `stripHtml`:

```typescript
export function stripHtml(raw: string): string {
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 4: Run tests — verify stripHtml tests pass**

```bash
node --import tsx --test mtg-jumpstarts.test.ts
```

Expected: 4 passing

- [ ] **Step 5: Write failing tests for extractJson**

Add to `mtg-jumpstarts.test.ts`:

```typescript
test('extractJson returns plain JSON unchanged', () => {
  const json = '[{"name": "Plains"}]';
  assert.equal(extractJson(json), json);
});

test('extractJson strips json markdown fences', () => {
  const text = '```json\n[{"name": "Plains"}]\n```';
  assert.equal(extractJson(text), '[{"name": "Plains"}]');
});

test('extractJson strips plain markdown fences', () => {
  const text = '```\n{"theme": "White"}\n```';
  assert.equal(extractJson(text), '{"theme": "White"}');
});
```

- [ ] **Step 6: Run tests — verify extractJson tests fail**

```bash
node --import tsx --test mtg-jumpstarts.test.ts
```

Expected: 3 new failures

- [ ] **Step 7: Implement extractJson**

Replace the placeholder `extractJson`:

```typescript
export function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  return match ? match[1].trim() : text.trim();
}
```

- [ ] **Step 8: Run all tests — verify all pass**

```bash
node --import tsx --test mtg-jumpstarts.test.ts
```

Expected: 7 passing

- [ ] **Step 9: Commit**

```bash
git add mtg-jumpstarts.ts mtg-jumpstarts.test.ts
git commit -m "feat: add stripHtml and extractJson utilities"
```

---

### Task 3: URL utilities — buildSeriesUrl and HTTP fetching

**Files:**
- Modify: `mtg-jumpstarts.ts`
- Modify: `mtg-jumpstarts.test.ts`

**Interfaces:**
- Produces: `buildSeriesUrl(keyword: string): string`, `fetchHtml(url: string): Promise<string>`, `fetchSeriesPageWithFallback(keyword: string): Promise<string>`
- Consumes: nothing from prior tasks (fetchHtml uses Node built-in `fetch`)

- [ ] **Step 1: Write failing tests for buildSeriesUrl**

Add to `mtg-jumpstarts.test.ts`:

```typescript
test('buildSeriesUrl capitalizes and underscores single word', () => {
  assert.equal(
    buildSeriesUrl('foundations'),
    'https://mtg.wiki/page/Foundations_Jumpstart'
  );
});

test('buildSeriesUrl handles multi-word keyword', () => {
  assert.equal(
    buildSeriesUrl('marvel super heroes'),
    'https://mtg.wiki/page/Marvel_Super_Heroes_Jumpstart'
  );
});

test('buildSeriesUrl preserves colons from keyword', () => {
  assert.equal(
    buildSeriesUrl('Avatar: The Last Airbender'),
    'https://mtg.wiki/page/Avatar:_The_Last_Airbender_Jumpstart'
  );
});

test('buildSeriesUrl trims leading/trailing whitespace', () => {
  assert.equal(
    buildSeriesUrl('  foundations  '),
    'https://mtg.wiki/page/Foundations_Jumpstart'
  );
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --import tsx --test mtg-jumpstarts.test.ts
```

Expected: 4 new failures

- [ ] **Step 3: Implement buildSeriesUrl**

Replace the placeholder `buildSeriesUrl`:

```typescript
export function buildSeriesUrl(keyword: string): string {
  const normalized = keyword
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('_');
  return `https://mtg.wiki/page/${normalized}_Jumpstart`;
}
```

- [ ] **Step 4: Run tests — verify all 11 pass**

```bash
node --import tsx --test mtg-jumpstarts.test.ts
```

Expected: 11 passing

- [ ] **Step 5: Implement fetchHtml and fetchSeriesPageWithFallback**

Add these after the `buildSeriesUrl` function (not exported — internal use only):

```typescript
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'mtg-jumpstarts-cli/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function fetchSeriesPageWithFallback(keyword: string): Promise<string> {
  const query = encodeURIComponent(`${keyword} Jumpstart`);
  const searchUrl = `https://mtg.wiki/api.php?action=query&list=search&srsearch=${query}&format=json`;
  const res = await fetch(searchUrl, { headers: { 'User-Agent': 'mtg-jumpstarts-cli/1.0' } });
  if (!res.ok) throw new Error(`MediaWiki search failed: HTTP ${res.status}`);
  const data = await res.json() as { query: { search: Array<{ title: string }> } };
  const results = data.query?.search;
  if (!results?.length) throw new Error(`No wiki pages found for "${keyword} Jumpstart"`);
  const title = results[0].title.replace(/ /g, '_');
  return fetchHtml(`https://mtg.wiki/page/${title}`);
}
```

- [ ] **Step 6: Commit**

```bash
git add mtg-jumpstarts.ts mtg-jumpstarts.test.ts
git commit -m "feat: add URL construction and HTML fetching"
```

---

### Task 4: Phase 1 — discoverThemes Claude agent

**Files:**
- Modify: `mtg-jumpstarts.ts`

**Interfaces:**
- Consumes: `stripHtml`, `extractJson`, `Theme` type
- Produces: `discoverThemes(client: Anthropic, html: string): Promise<Theme[]>`

- [ ] **Step 1: Implement discoverThemes**

Add after `fetchSeriesPageWithFallback`:

```typescript
async function discoverThemes(client: Anthropic, html: string): Promise<Theme[]> {
  const content = stripHtml(html);

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are parsing a Magic: The Gathering Jumpstart series wiki page.
Extract all Jumpstart theme names and their decklist subpage URLs.
Look for links matching the pattern: /Decklists_-_<ThemeName>
Each theme is a named variant of the series (e.g., "White", "Water Tribe", "Fire Nation").

Return ONLY a JSON array — no explanation, no markdown fences:
[{"name": "ThemeName", "url": "https://mtg.wiki/page/..."}]

PAGE CONTENT:
${content}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    try {
      const parsed = JSON.parse(extractJson(text));
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Expected non-empty array');
      return parsed as Theme[];
    } catch {
      if (attempt === 1) throw new Error(`Theme discovery returned malformed JSON: ${text.slice(0, 200)}`);
    }
  }
  throw new Error('unreachable');
}
```

- [ ] **Step 2: Manual integration test — smoke test Phase 1**

Run a quick test against the Avatar series to verify the agent finds themes:

```bash
node --input-type=module --import tsx << 'EOF'
import Anthropic from '@anthropic-ai/sdk';
import { buildSeriesUrl, stripHtml, extractJson } from './mtg-jumpstarts.ts';

const client = new Anthropic();
const url = buildSeriesUrl('Avatar: The Last Airbender');
console.error('Fetching:', url);
const res = await fetch(url, { headers: { 'User-Agent': 'test' } });
const html = await res.text();
const content = stripHtml(html);
console.error('Stripped length:', content.length, 'chars');
console.error('First 500 chars:');
console.error(content.slice(0, 500));
EOF
```

Expected: Stripped content length > 0, visible text about the series. If the page loads and has readable text, Phase 1 is ready to wire up.

- [ ] **Step 3: Commit**

```bash
git add mtg-jumpstarts.ts
git commit -m "feat: add discoverThemes Claude Haiku agent (Phase 1)"
```

---

### Task 5: Phase 2 — extractDecklist Claude agent

**Files:**
- Modify: `mtg-jumpstarts.ts`

**Interfaces:**
- Consumes: `stripHtml`, `extractJson`, `Theme`, `Decklist`, `Category`, `Card` types
- Produces: `extractDecklist(client: Anthropic, theme: Theme, html: string): Promise<Decklist>`

- [ ] **Step 1: Implement extractDecklist**

Add after `discoverThemes`:

```typescript
async function extractDecklist(client: Anthropic, theme: Theme, html: string): Promise<Decklist> {
  const content = stripHtml(html);

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are parsing a Magic: The Gathering Jumpstart decklist wiki page for theme "${theme.name}".
Extract the theme name and all cards grouped by category (Creatures, Instants, Sorceries, Enchantments, Artifacts, Planeswalkers, Lands, etc.).

Return ONLY a JSON object — no explanation, no markdown fences:
{
  "theme": "ThemeName",
  "categories": [
    {"name": "Creatures", "cards": [{"qty": 2, "name": "Card Name"}]},
    {"name": "Lands", "cards": [{"qty": 9, "name": "Plains"}]}
  ]
}

Rules:
- Preserve the category order as shown on the page
- If no quantity is shown for a card, use 1
- Use the exact card name as printed on the page

PAGE CONTENT:
${content}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    try {
      const parsed = JSON.parse(extractJson(text)) as Decklist;
      if (!parsed.theme || !Array.isArray(parsed.categories)) throw new Error('Invalid structure');
      return parsed;
    } catch {
      if (attempt === 1) throw new Error(`Decklist extraction malformed for "${theme.name}": ${text.slice(0, 200)}`);
    }
  }
  throw new Error('unreachable');
}
```

- [ ] **Step 2: Commit**

```bash
git add mtg-jumpstarts.ts
git commit -m "feat: add extractDecklist Claude Haiku agent (Phase 2)"
```

---

### Task 6: Scryfall price lookup

**Files:**
- Modify: `mtg-jumpstarts.ts`

**Interfaces:**
- Consumes: `Card`, `Decklist`, `PricedCard`, `PricedCategory`, `PricedDecklist` types
- Produces: `priceDecklists(decklists: Decklist[]): Promise<PricedDecklist[]>`

Scryfall collection endpoint: `POST https://api.scryfall.com/cards/collection`  
Body: `{ "identifiers": [{"name": "Card Name"}, ...] }` (max 75 per request)  
Response: `{ "data": [{ "name": "...", "prices": { "usd": "1.50" | null } }] }`

- [ ] **Step 1: Implement fetchScryfallPrices helper**

Add after `extractDecklist`:

```typescript
async function fetchScryfallPrices(cardNames: string[]): Promise<Map<string, number | null>> {
  const priceMap = new Map<string, number | null>();
  const BATCH_SIZE = 75;

  for (let i = 0; i < cardNames.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise(r => setTimeout(r, 100)); // Scryfall rate limit

    const batch = cardNames.slice(i, i + BATCH_SIZE);
    const body = { identifiers: batch.map(name => ({ name })) };

    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'mtg-jumpstarts-cli/1.0',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`Scryfall batch ${i / BATCH_SIZE + 1} failed: HTTP ${res.status}`);
      batch.forEach(name => priceMap.set(name, null));
      continue;
    }

    const data = await res.json() as {
      data: Array<{ name: string; prices: { usd: string | null } }>;
    };

    for (const card of data.data) {
      const usd = card.prices?.usd;
      priceMap.set(card.name, usd !== null && usd !== undefined ? parseFloat(usd) : null);
    }

    // Cards not found in response (Scryfall "not_found") — set null
    for (const name of batch) {
      if (!priceMap.has(name)) priceMap.set(name, null);
    }
  }

  return priceMap;
}
```

- [ ] **Step 2: Implement priceDecklists**

Add after `fetchScryfallPrices`:

```typescript
function powerTier(total: number): 'Budget' | 'Mid' | 'Premium' {
  if (total < 5) return 'Budget';
  if (total < 15) return 'Mid';
  return 'Premium';
}

async function priceDecklists(decklists: Decklist[]): Promise<PricedDecklist[]> {
  // Collect all unique card names across all decklists
  const allNames = [...new Set(decklists.flatMap(d =>
    d.categories.flatMap(cat => cat.cards.map(c => c.name))
  ))];

  console.error(`Looking up prices for ${allNames.length} unique cards via Scryfall...`);
  const priceMap = await fetchScryfallPrices(allNames);

  return decklists.map(decklist => {
    let deckTotal = 0;

    const pricedCategories: PricedCategory[] = decklist.categories.map(cat => {
      let categoryTotal = 0;
      const pricedCards: PricedCard[] = cat.cards.map(card => {
        const unitPrice = priceMap.get(card.name) ?? null;
        if (unitPrice !== null) categoryTotal += unitPrice * card.qty;
        return { ...card, unitPrice };
      });
      deckTotal += categoryTotal;
      return { name: cat.name, cards: pricedCards, categoryTotal };
    });

    return {
      theme: decklist.theme,
      categories: pricedCategories,
      deckTotal,
      powerTier: powerTier(deckTotal),
    };
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add mtg-jumpstarts.ts
git commit -m "feat: add Scryfall price lookup and deck pricing"
```

---

### Task 7: Output formatting — printResults

**Files:**
- Modify: `mtg-jumpstarts.ts`
- Modify: `mtg-jumpstarts.test.ts`

**Interfaces:**
- Consumes: `PricedDecklist`, `PricedCategory`, `PricedCard`
- Produces: `printResults(keyword: string, decklists: PricedDecklist[]): void`

- [ ] **Step 1: Write failing test for printResults**

Add to `mtg-jumpstarts.test.ts`:

```typescript
test('printResults formats deck header, categories, cards, and totals', () => {
  const output: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => output.push(args.join(' '));

  const decklist = {
    theme: 'White',
    categories: [
      {
        name: 'Creatures',
        cards: [{ qty: 2, name: 'Air Nomad', unitPrice: 1.50 }],
        categoryTotal: 3.00,
      },
      {
        name: 'Lands',
        cards: [{ qty: 9, name: 'Plains', unitPrice: 0.10 }],
        categoryTotal: 0.90,
      },
    ],
    deckTotal: 3.90,
    powerTier: 'Budget' as const,
  };

  printResults('White', [decklist]);
  console.log = origLog;

  const all = output.join('\n');
  assert.ok(all.includes('WHITE JUMPSTART'), 'Should include series header');
  assert.ok(all.includes('--- White ---'), 'Should include theme header');
  assert.ok(all.includes('Creatures'), 'Should include category name');
  assert.ok(all.includes('2x Air Nomad'), 'Should include card with quantity');
  assert.ok(all.includes('$1.50'), 'Should include unit price');
  assert.ok(all.includes('$3.90'), 'Should include deck total');
  assert.ok(all.includes('Budget'), 'Should include power tier');
});

test('printResults warns when card count is not 20', () => {
  const output: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => output.push(args.join(' '));

  const decklist = {
    theme: 'Blue',
    categories: [{
      name: 'Lands',
      cards: [{ qty: 5, name: 'Island', unitPrice: 0.10 }],
      categoryTotal: 0.50,
    }],
    deckTotal: 0.50,
    powerTier: 'Budget' as const,
  };

  printResults('Test', [decklist]);
  console.log = origLog;

  const all = output.join('\n');
  assert.ok(all.includes('⚠'), 'Should show warning for wrong card count');
  assert.ok(all.includes('5 cards'), 'Should show actual count');
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --import tsx --test mtg-jumpstarts.test.ts
```

Expected: 2 new failures

- [ ] **Step 3: Implement printResults**

Replace the placeholder `printResults`:

```typescript
export function printResults(keyword: string, decklists: PricedDecklist[]): void {
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  console.log(`\n=== ${keyword.toUpperCase()} JUMPSTART ===`);
  console.log(`Found ${decklists.length} themes.\n`);

  for (const decklist of decklists) {
    const totalCards = decklist.categories.reduce(
      (sum, cat) => sum + cat.cards.reduce((s, c) => s + c.qty, 0), 0
    );
    const countWarning = totalCards !== 20 ? ` ⚠ ${totalCards} cards (expected 20)` : '';
    console.log(`--- ${decklist.theme} ---${countWarning}`);

    for (const cat of decklist.categories) {
      const catCards = cat.cards.reduce((s, c) => s + c.qty, 0);
      const catPrice = cat.categoryTotal > 0 ? `  ${fmt(cat.categoryTotal)}` : '';
      console.log(`${cat.name} (${catCards} cards)${catPrice}`);

      for (const card of cat.cards) {
        const lineTotal = card.unitPrice !== null ? card.unitPrice * card.qty : null;
        const priceCol = card.unitPrice !== null
          ? `  ${fmt(card.unitPrice)} ea  ${fmt(lineTotal!)}`
          : '  (price unknown)';
        console.log(`  ${card.qty}x ${card.name}${priceCol}`);
      }
    }

    console.log(`[${totalCards} cards total | Deck value: ${fmt(decklist.deckTotal)} | Power: ${decklist.powerTier}]`);
    console.log('');
  }
}
```

- [ ] **Step 4: Run all tests — verify all pass**

```bash
node --import tsx --test mtg-jumpstarts.test.ts
```

Expected: 13 passing (all prior tests + 2 new)

- [ ] **Step 5: Commit**

```bash
git add mtg-jumpstarts.ts mtg-jumpstarts.test.ts
git commit -m "feat: add formatted output with prices and power tier"
```

---

### Task 8: Main orchestrator + end-to-end test

**Files:**
- Modify: `mtg-jumpstarts.ts`

**Interfaces:**
- Consumes: all prior functions
- Produces: working CLI

- [ ] **Step 1: Implement main()**

Replace the placeholder `main()`:

```typescript
async function main(): Promise<void> {
  const keyword = process.argv[2];
  if (!keyword) {
    console.error('Usage: npx tsx mtg-jumpstarts.ts "<series name>"');
    console.error('Examples:');
    console.error('  npx tsx mtg-jumpstarts.ts "foundations"');
    console.error('  npx tsx mtg-jumpstarts.ts "Avatar: The Last Airbender"');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  const client = new Anthropic();

  // ── Phase 1: Discover themes ──────────────────────────────────────────────
  console.error(`\nSearching for "${keyword}" Jumpstart themes on mtg.wiki...`);
  let seriesHtml: string;
  const primaryUrl = buildSeriesUrl(keyword);

  try {
    seriesHtml = await fetchHtml(primaryUrl);
    console.error(`Loaded: ${primaryUrl}`);
  } catch {
    console.error(`Primary URL failed (${primaryUrl}), trying MediaWiki search...`);
    seriesHtml = await fetchSeriesPageWithFallback(keyword);
  }

  const themes = await discoverThemes(client, seriesHtml);
  console.error(`Found ${themes.length} themes: ${themes.map(t => t.name).join(', ')}`);

  if (themes.length === 0) {
    console.error('No themes found. The wiki page may not list individual decklist subpages yet.');
    process.exit(1);
  }

  // ── Phase 2: Parallel decklist extraction ─────────────────────────────────
  console.error(`\nFetching ${themes.length} decklists in parallel...`);
  const rawResults = await Promise.all(
    themes.map(async (theme): Promise<Decklist | null> => {
      try {
        const html = await fetchHtml(theme.url);
        const decklist = await extractDecklist(client, theme, html);
        console.error(`  ✓ ${theme.name}`);
        return decklist;
      } catch (err) {
        console.error(`  ✗ ${theme.name}: ${err}`);
        return null;
      }
    })
  );

  const decklists = rawResults.filter((d): d is Decklist => d !== null);
  if (decklists.length === 0) {
    console.error('All decklist extractions failed. Check the theme URLs above.');
    process.exit(1);
  }

  // ── Price lookup ──────────────────────────────────────────────────────────
  const pricedDecklists = await priceDecklists(decklists);

  // ── Output ────────────────────────────────────────────────────────────────
  printResults(keyword, pricedDecklists);
}
```

- [ ] **Step 2: Run unit tests one final time to confirm nothing broke**

```bash
node --import tsx --test mtg-jumpstarts.test.ts
```

Expected: 13 passing

- [ ] **Step 3: End-to-end test — Avatar series (has known decklist pages)**

```bash
npx tsx mtg-jumpstarts.ts "Avatar: The Last Airbender"
```

Expected progress on stderr (e.g. `Found N themes: White, Water Tribe, ...`), then formatted output on stdout. Each theme should show ~20 cards with prices and a deck total.

If theme count is 0: the wiki page structure may differ — inspect the stripped HTML from Task 4 Step 2 to see what link patterns exist.

If card count warnings appear (⚠): that's expected for any theme the agent miscounted; the data is still usable.

- [ ] **Step 4: Smoke test a second series**

```bash
npx tsx mtg-jumpstarts.ts "foundations"
```

Expected: Similar output for the Foundations Jumpstart series.

- [ ] **Step 5: Final commit**

```bash
git add mtg-jumpstarts.ts
git commit -m "feat: wire main orchestrator — MTG Jumpstart CLI complete"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] CLI invocation with keyword arg — Task 8
- [x] Phase 1 sequential agent finds themes — Task 4
- [x] Phase 2 parallel agents per theme — Task 5 + Task 8
- [x] Cards grouped by category — Task 5 (agent prompt)
- [x] 20-card validation warning — Task 7
- [x] HTML preprocessing (stripHtml) — Task 2
- [x] MediaWiki search fallback — Task 3
- [x] Retry on malformed JSON — Tasks 4 & 5 (2-attempt loop)
- [x] ANTHROPIC_API_KEY guard — Task 8
- [x] Scryfall per-card prices — Task 6
- [x] Category price totals — Task 6
- [x] Deck total and power tier — Task 6 + 7
- [x] Progress to stderr, results to stdout — Tasks 4, 8

**Type consistency check:**
- `PricedCard` extends `Card` with `unitPrice: number | null` — used consistently in Tasks 6 & 7
- `PricedCategory` has `categoryTotal: number` — set in Task 6, read in Task 7
- `PricedDecklist` has `deckTotal` and `powerTier` — set in Task 6, read in Task 7
- `powerTier()` returns `'Budget' | 'Mid' | 'Premium'` — matches `PricedDecklist.powerTier` type
