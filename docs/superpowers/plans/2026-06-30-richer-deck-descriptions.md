# Richer Deck Descriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic 1-2 sentence deck descriptions (guessed from card names only) with full-paragraph, oracle-text-grounded descriptions that name real combos when they exist, and condense the printed insert card's pairing reasons to keyword tags.

**Architecture:** Move description generation out of the per-theme card-extraction Claude calls into one unified post-processing step (Sonnet, batched ~10 themes/call) that runs for every series after cards are known, using oracle text fetched from Scryfall's existing bulk endpoint. Card-extraction agents (Haiku) go back to doing one job: pulling cards accurately.

**Tech Stack:** TypeScript (ESM, run via `tsx`, no build step), `@anthropic-ai/sdk`, Scryfall REST API. No test framework in this repo — verification is manual, following the existing project convention (see `DEVELOPMENT.md` and prior spec "Testing" sections).

## Global Constraints

- Oracle text is fetched transiently at bake time and is **not** persisted in `data/*.json` — only the resulting `description` string is baked, same as today.
- Description generation uses **Sonnet** (`claude-sonnet-5`); card extraction stays on **Haiku** (`claude-haiku-4-5-20251001`, the existing `callAgent` default) — do not change extraction's model.
- Batch ~10 themes per description-generation call (`DESCRIPTION_BATCH_SIZE = 10`) to avoid output truncation on large series (Avatar/Marvel run ~50 themes).
- 1-2 named combos are called out **only** when the actual oracle text supports them — never fabricate one; say plainly when a deck has no standout interaction.
- Pairing-reason condensation (5-6 keywords, not full sentences) applies **only** to the `format_deck_insert_card` flow (`mcp-server.ts` schema text + the "Generating a deck insert card" section of `SKILL.md`). Do not touch the general "Giving recommendations" conversational guidance in `SKILL.md` — that stays full-sentence.
- This plan regenerates `data/marvel.json` only, as a test. Do not regenerate the other 5 series' data files.
- No new npm scripts, test framework, or dependencies — follow the existing manual-verification pattern.

---

### Task 1: Oracle text in `scryfall.ts`

**Files:**
- Modify: `src/scryfall.ts`

**Interfaces:**
- Consumes: nothing new (same Scryfall `/cards/collection` response, one more field read off it).
- Produces: `ScryfallCardData` gains `text: string | null`. `fetchScryfallCardData(cardNames: string[]): Promise<Map<string, ScryfallCardData>>` signature is unchanged — only the value type grows a field. Consumed by Task 4 (`refresh-data.ts`) to build a `Map<string, string | null>` of card name → oracle text.

- [ ] **Step 1: Add `text` to `ScryfallCardData` and populate it from the Scryfall response**

Replace the full contents of `src/scryfall.ts` with:

```ts
// Scryfall API: fetch USD price, rarity, colors, and oracle text for a list of
// card names. Uses the /cards/collection bulk endpoint (max 75 cards per
// request), which already returns rarity/colors/oracle_text alongside price on
// the same card object -- no extra requests needed to get them.
// Up to 4 requests run in parallel; a short delay between batches avoids
// hitting Scryfall's 10 req/sec rate limit.

const BATCH_SIZE = 75;
const MAX_CONCURRENT = 4;

export type ScryfallCardData = {
  price: number | null;
  rarity: string | null;
  colors: string[];
  text: string | null;
};

export async function fetchScryfallCardData(
  cardNames: string[],
): Promise<Map<string, ScryfallCardData>> {
  const cardDataMap = new Map<string, ScryfallCardData>();

  const batches: string[][] = [];
  for (let i = 0; i < cardNames.length; i += BATCH_SIZE) {
    batches.push(cardNames.slice(i, i + BATCH_SIZE));
  }

  const unknown: ScryfallCardData = { price: null, rarity: null, colors: [], text: null };

  const fetchBatch = async (batch: string[]) => {
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'mtg-jumpstarts-cli/1.0',
      },
      body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
    });

    if (!res.ok) {
      console.error(`Scryfall batch failed: HTTP ${res.status}`);
      batch.forEach(name => cardDataMap.set(name, unknown));
      return;
    }

    const data = await res.json() as {
      data: Array<{
        name: string;
        prices: { usd: string | null };
        rarity?: string;
        colors?: string[];
        oracle_text?: string;
        card_faces?: Array<{ oracle_text?: string }>;
      }>;
    };

    for (const card of data.data) {
      const usd = card.prices?.usd;
      const text = card.oracle_text
        ?? (card.card_faces?.map(f => f.oracle_text).filter(Boolean).join(' // ') || null);
      cardDataMap.set(card.name, {
        price: usd != null ? parseFloat(usd) : null,
        rarity: card.rarity ?? null,
        colors: card.colors ?? [],
        text: text || null,
      });
    }
    // Mark any cards not returned by Scryfall as unknown
    for (const name of batch) {
      if (!cardDataMap.has(name)) cardDataMap.set(name, unknown);
    }
  };

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    await Promise.all(batches.slice(i, i + MAX_CONCURRENT).map(fetchBatch));
  }

  return cardDataMap;
}
```

- [ ] **Step 2: Write a throwaway verification script**

Create `/private/tmp/claude-501/-Users-teodellamico-Code-mtg-jumpstarts/41694dd7-c13a-4b08-b2ee-b85433b07807/scratchpad/verify-scryfall-text.ts` (adjust the path if your scratchpad directory differs):

```ts
import { fetchScryfallCardData } from '/Users/teodellamico/Code/mtg-jumpstarts/src/scryfall.js';

const map = await fetchScryfallCardData(['Lightning Bolt', 'Plains']);
console.log('Lightning Bolt:', map.get('Lightning Bolt'));
console.log('Plains:', map.get('Plains'));
```

- [ ] **Step 3: Run it and confirm oracle text comes back**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx /private/tmp/claude-501/-Users-teodellamico-Code-mtg-jumpstarts/41694dd7-c13a-4b08-b2ee-b85433b07807/scratchpad/verify-scryfall-text.ts`

Expected: `Lightning Bolt:` line shows `text: 'Lightning Bolt deals 3 damage to any target.'` (or equivalent current Oracle wording) and non-null `rarity`/`colors`/`price`. `Plains:` line shows `text: null` (basic lands have no rules text) but non-null `rarity`/`colors`.

- [ ] **Step 4: Commit**

```bash
git add src/scryfall.ts
git commit -m "feat: fetch oracle text alongside price/rarity/colors from Scryfall"
```

---

### Task 2: Schema changes in `tools.ts`

**Files:**
- Modify: `src/tools.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DECKLIST_ITEM_SCHEMA` (and the `DECKLIST_TOOL`/`DECKLISTS_TOOL` that reuse it) no longer has a `description` property — consumed by Task 3's `extractDecklist`/`extractThemeFromPage`, which must stop expecting the model to return one. `DESCRIPTIONS_TOOL`'s `description` field gets new instruction text — consumed by Task 3's `describeDecks`.

- [ ] **Step 1: Remove `description` from `DECKLIST_ITEM_SCHEMA`**

In `src/tools.ts`, replace:

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

with:

```ts
export const DECKLIST_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    theme: { type: 'string', description: 'Theme name' },
    categories: {
```

and further down, replace:

```ts
        required: ['name', 'cards'],
      },
    },
  },
  required: ['theme', 'description', 'categories'],
};
```

with:

```ts
        required: ['name', 'cards'],
      },
    },
  },
  required: ['theme', 'categories'],
};
```

- [ ] **Step 2: Update `DESCRIPTIONS_TOOL`'s description field text**

Replace:

```ts
export const DESCRIPTIONS_TOOL: Anthropic.Tool = {
  name: 'report_descriptions',
  description: 'Report a short play-pattern description for each decklist',
  input_schema: {
    type: 'object',
    properties: {
      descriptions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            theme: { type: 'string', description: 'Exact theme name, copied verbatim from the provided list' },
            description: {
              type: 'string',
              description: 'How this deck plays in 1-2 sentences, e.g. "big creatures", "spell heavy", "lots of tokens"',
            },
          },
          required: ['theme', 'description'],
        },
      },
    },
    required: ['descriptions'],
  },
};
```

with:

```ts
export const DESCRIPTIONS_TOOL: Anthropic.Tool = {
  name: 'report_descriptions',
  description: 'Report a full play-pattern description, grounded in oracle text, for each decklist',
  input_schema: {
    type: 'object',
    properties: {
      descriptions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            theme: { type: 'string', description: 'Exact theme name, copied verbatim from the provided list' },
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
          },
          required: ['theme', 'description'],
        },
      },
    },
    required: ['descriptions'],
  },
};
```

- [ ] **Step 3: Verify the schema shape**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx -e "import('./src/tools.js').then(m => { console.log(JSON.stringify(m.DECKLIST_ITEM_SCHEMA.required)); console.log(m.DESCRIPTIONS_TOOL.input_schema.properties.descriptions.items.properties.description.description.includes('full paragraph')); })"`

Expected: first line `["theme","categories"]` (no `"description"`), second line `true`.

- [ ] **Step 4: Commit**

```bash
git add src/tools.ts
git commit -m "feat: move description generation off the card-extraction schema"
```

---

### Task 3: Rework `agents.ts` — batched, oracle-text-grounded `describeDecks`

**Files:**
- Modify: `src/agents.ts`

**Interfaces:**
- Consumes: `DESCRIPTIONS_TOOL` (Task 2), `ScryfallCardData.text` shape via a `Map<string, string | null>` param (Task 1's output shape, built by the caller in Task 4).
- Produces:
  - `chunk<T>(items: T[], size: number): T[][]` — new exported pure helper.
  - `describeDecks(client: Anthropic, semaphore: Semaphore, decks: { theme: string; categories: Category[] }[], cardText: Map<string, string | null>): Promise<Map<string, string>>` — signature grows a 4th required parameter (`cardText`). Consumed by Task 4.
  - `extractThemeFromPage(...): Promise<Decklist[]>` and `extractDecklist(...): Promise<Decklist>` — unchanged signatures, but every returned `Decklist` now always has `description: ''` (no longer guessed by the model).

- [ ] **Step 1: Add the `chunk` helper**

In `src/agents.ts`, add near the top (after imports, before `discoverThemes`):

```ts
// ─── Chunking helper ────────────────────────────────────────────────────────

export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}
```

- [ ] **Step 2: Verify `chunk` with a pure assertion (no network/API needed)**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx -e "
import('./src/agents.js').then(m => {
  const result = m.chunk([1,2,3,4,5], 2);
  const expected = [[1,2],[3,4],[5]];
  console.log(JSON.stringify(result) === JSON.stringify(expected) ? 'PASS' : 'FAIL: ' + JSON.stringify(result));
});
"`

Expected: `PASS`

- [ ] **Step 3: Strip the description-writing instruction from `extractThemeFromPage`, default `description` to `''`**

Replace:

```ts
  Ignore every other theme on this page. Return only decklists for "${theme.name}".

For each decklist, also write a 1-2 sentence description of how the deck plays (e.g. "big creatures",
"spell heavy", "lots of tokens") based on the cards in it.

Use the report_decklists tool to return the decklist(s) you find.

PAGE CONTENT:`;

  const result = await withRetry(
    () => callAgent<{ decklists: Decklist[] }>(client, semaphore, DECKLISTS_TOOL, instructions, content, 4096),
    theme.name,
  );

  return result.decklists ?? [];
}
```

with:

```ts
  Ignore every other theme on this page. Return only decklists for "${theme.name}".

Use the report_decklists tool to return the decklist(s) you find.

PAGE CONTENT:`;

  const result = await withRetry(
    () => callAgent<{ decklists: Decklist[] }>(client, semaphore, DECKLISTS_TOOL, instructions, content, 4096),
    theme.name,
  );

  return (result.decklists ?? []).map(d => ({ ...d, description: '' }));
}
```

- [ ] **Step 4: Strip the description-writing instruction from `extractDecklist`, default `description` to `''`**

Replace:

```ts
Use qty=1 for any card with no explicit quantity listed.

Also write a 1-2 sentence description of how the deck plays (e.g. "big creatures", "spell heavy",
"lots of tokens") based on the cards you extracted.

Use the report_decklist tool to return the structured decklist.

PAGE CONTENT:`;

  return withRetry(
    () => callAgent<Decklist>(client, semaphore, DECKLIST_TOOL, instructions, content, 4096),
    theme.name,
  );
}
```

with:

```ts
Use qty=1 for any card with no explicit quantity listed.

Use the report_decklist tool to return the structured decklist.

PAGE CONTENT:`;

  const result = await withRetry(
    () => callAgent<Decklist>(client, semaphore, DECKLIST_TOOL, instructions, content, 4096),
    theme.name,
  );
  return { ...result, description: '' };
}
```

- [ ] **Step 5: Replace `describeDecks` with the batched, oracle-text-grounded version**

Replace the entire existing `describeDecks` function (from its leading comment block through its closing `}`) with:

```ts
// ─── Description generation (oracle-text-grounded) ────────────────────────────
// Runs for every series, after cards are known (either extracted via Claude or
// parsed deterministically from mtg.wiki markup) — only the "how does this
// play" judgment requires the model. Batches themes (~10 per call) so a single
// call's output never risks truncation on a large series (Avatar/Marvel run
// ~50 themes). Uses Sonnet, not Haiku — spotting a real combo in rules text is
// a reasoning task, unlike the mechanical card extraction the other agents do.

const DESCRIPTION_BATCH_SIZE = 10;

export async function describeDecks(
  client: Anthropic,
  semaphore: Semaphore,
  decks: { theme: string; categories: Category[] }[],
  cardText: Map<string, string | null>,
): Promise<Map<string, string>> {
  const batches = chunk(decks, DESCRIPTION_BATCH_SIZE);
  const results = await Promise.all(
    batches.map((batch, i) => describeBatch(client, semaphore, batch, cardText, i)),
  );
  return new Map(results.flatMap(m => [...m]));
}

async function describeBatch(
  client: Anthropic,
  semaphore: Semaphore,
  decks: { theme: string; categories: Category[] }[],
  cardText: Map<string, string | null>,
  batchIndex: number,
): Promise<Map<string, string>> {
  const content = decks.map(d => {
    const cardLines = d.categories.flatMap(cat =>
      cat.cards.map(card => {
        const text = cardText.get(card.name);
        return `${card.qty}x ${card.name}${text ? ` — ${text}` : ''}`;
      }),
    );
    return `=== ${d.theme} ===\n${cardLines.join('\n')}`;
  }).join('\n\n');

  const instructions = `You are summarizing Magic: The Gathering Jumpstart decklists for players who want a
real sense of how each deck plays before drafting or building around it.

For each decklist below, write a full paragraph (not 1-2 sentences) describing:
1. Its overall strategy and playstyle.
2. Only if the actual card text below genuinely supports it — 1-2 concrete combos or
   synergies, naming the specific cards and what they do together (e.g. "Card A's trigger
   feeds Card B's ability"). Do not invent a combo that isn't really there: if the deck is a
   straightforward value/curve pile with no standout interaction, say so plainly and describe
   its game plan instead.

Avoid generic filler ("big creatures", "spell heavy", "lots of tokens") unless immediately
backed by the specific cards that make it true.

Use the report_descriptions tool to return one row per deck, using the exact theme name given
(copy it verbatim, including any numbered suffix like "1" or "2").

DECKLISTS (card lines show "qty x name — oracle text"):`;

  const result = await withRetry(
    () => callAgent<{ descriptions: { theme: string; description: string }[] }>(
      client, semaphore, DESCRIPTIONS_TOOL, instructions, content, 8192, 'claude-sonnet-5',
    ),
    `deck descriptions batch ${batchIndex}`,
  );

  return new Map((result.descriptions ?? []).map(d => [d.theme, d.description]));
}
```

- [ ] **Step 6: Smoke-test the file loads with no syntax/type errors**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx -e "import('./src/agents.js').then(m => console.log(Object.keys(m)))"`

Expected: prints an array including `discoverThemes`, `isSamePageGrouped`, `extractThemeFromPage`, `extractDecklist`, `describeDecks`, `chunk` — no thrown error. (This is a load-time smoke test; `describeDecks`/extraction functions themselves need `ANTHROPIC_API_KEY` and real HTML to exercise, which happens end-to-end in Task 6.)

- [ ] **Step 7: Commit**

```bash
git add src/agents.ts
git commit -m "feat: generate deck descriptions from oracle text via batched Sonnet calls"
```

---

### Task 4: Unify description generation in `refresh-data.ts`

**Files:**
- Modify: `scripts/refresh-data.ts`

**Interfaces:**
- Consumes: `fetchScryfallCardData` (Task 1), `describeDecks(client, semaphore, decks, cardText)` new 4-arg signature (Task 3).
- Produces: `data/<slug>.json` — same structural shape as today (`bakeSeries` output unchanged), richer `description` content.

- [ ] **Step 1: Add the `fetchScryfallCardData` import**

In `scripts/refresh-data.ts`, add to the import block (after the `wikiDeckBlocks` import):

```ts
import { fetchScryfallCardData } from '../src/scryfall.js';
```

- [ ] **Step 2: Replace the inline-vs-extraction branch + bake call with the unified flow**

Replace:

```ts
  // ── Type C: single-page inline decklists (e.g. LOTR Jumpstart) ──────────────
  const inlineDecks = parseScryfallDeckBlocks(seriesHtml);
  let coloredDecklists: Decklist[];

  if (inlineDecks.length > 0) {
    console.error(`Found ${inlineDecks.length} decklists embedded directly on the series page.`);
    const themeColors = parseThemeColors(seriesHtml);

    console.error('Generating deck descriptions (one consolidated call)...');
    const descriptions = await describeDecks(client, semaphore, inlineDecks);

    coloredDecklists = inlineDecks.map(d => ({
      theme: d.theme,
      categories: d.categories,
      description: descriptions.get(d.theme) ?? '',
      color: normalizeColor(matchBaseThemeColor(d.theme, themeColors)),
    }));
  } else {
    coloredDecklists = await extractViaThemeDiscovery(client, semaphore, seriesHtml, seriesUrl);
  }

  // ── Bake: flatten + write static data, no prices ────────────────────────────
  const baked = bakeSeries(keyword, coloredDecklists);
```

with:

```ts
  // ── Type C: single-page inline decklists (e.g. LOTR Jumpstart) ──────────────
  const inlineDecks = parseScryfallDeckBlocks(seriesHtml);
  let coloredDecklists: Decklist[];

  if (inlineDecks.length > 0) {
    console.error(`Found ${inlineDecks.length} decklists embedded directly on the series page.`);
    const themeColors = parseThemeColors(seriesHtml);

    coloredDecklists = inlineDecks.map(d => ({
      theme: d.theme,
      categories: d.categories,
      description: '',
      color: normalizeColor(matchBaseThemeColor(d.theme, themeColors)),
    }));
  } else {
    coloredDecklists = await extractViaThemeDiscovery(client, semaphore, seriesHtml, seriesUrl);
  }

  // ── Descriptions: oracle-text-grounded, one unified step for every series type ──
  console.error(`\nFetching oracle text for ${coloredDecklists.length} themes' cards...`);
  const allCardNames = [...new Set(
    coloredDecklists.flatMap(d => d.categories.flatMap(cat => cat.cards.map(c => c.name))),
  )];
  const cardData = await fetchScryfallCardData(allCardNames);
  const cardText = new Map([...cardData].map(([name, info]) => [name, info.text]));

  console.error('Generating descriptions (Sonnet, batched)...');
  const descriptions = await describeDecks(client, semaphore, coloredDecklists, cardText);
  coloredDecklists = coloredDecklists.map(d => ({
    ...d,
    description: descriptions.get(d.theme) ?? d.description,
  }));

  // ── Bake: flatten + write static data, no prices ────────────────────────────
  const baked = bakeSeries(keyword, coloredDecklists);
```

- [ ] **Step 3: Sanity-check the script still runs its no-args error path (no API key needed)**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx scripts/refresh-data.ts; echo "exit: $?"`

Expected: prints `Usage: npx tsx scripts/refresh-data.ts "<series name>"` followed by the list of valid series, then `exit: 1`. (Confirms the file still parses and the early-exit argument check is intact — full end-to-end behavior is verified in Task 6.)

- [ ] **Step 4: Commit**

```bash
git add scripts/refresh-data.ts
git commit -m "feat: fetch oracle text and generate descriptions after cards are known, for every series type"
```

---

### Task 5: Condense insert-card pairing reasons to keyword tags

**Files:**
- Modify: `src/mcp-server.ts:69,81` (the `format_deck_insert_card` tool's `description` and `pairings[].reason` schema text)
- Modify: `skills/jumpstart-deck-strategy/SKILL.md:57` (step 2 of "Generating a deck insert card")

**Interfaces:**
- Consumes: nothing code-level — text-only changes to tool-facing instructions.
- Produces: updated guidance text read by the calling Claude at request time; no runtime behavior change in `deckInsertCard.ts` (it already prints `reason` as opaque text).

- [ ] **Step 1: Update `format_deck_insert_card`'s schema text in `src/mcp-server.ts`**

Replace:

```ts
      description: z.string().describe('How this deck plays, 1-2 sentences'),
```

with:

```ts
      description: z.string().describe('Full paragraph: playstyle, strategy, and any concrete combos grounded in the cards'),
```

Replace:

```ts
      pairings: z.array(z.object({
        theme: z.string(),
        color: z.string(),
        reason: z.string().describe('1-2 sentences on why this pairs well with the main theme'),
      })).min(1).max(5).describe('Up to 5 suggested pairing themes from the same series'),
```

with:

```ts
      pairings: z.array(z.object({
        theme: z.string(),
        color: z.string(),
        reason: z.string().describe('5-6 keywords or a short phrase capturing the playstyle synergy (e.g. "ally colors, mana fixing, protects combo") — not a full sentence'),
      })).min(1).max(5).describe('Up to 5 suggested pairing themes from the same series'),
```

- [ ] **Step 2: Update `SKILL.md` step 2 of "Generating a deck insert card"**

In `skills/jumpstart-deck-strategy/SKILL.md`, replace:

```markdown
2. Reason about up to 5 pairing themes for the target theme, using the heuristics above (color balance, curve, removal/threat balance, evasion, archetype identity, color pie). Write a specific 1-2 sentence reason for each, same standard as any other pairing recommendation.
```

with:

```markdown
2. Reason about up to 5 pairing themes for the target theme, using the heuristics above (color balance, curve, removal/threat balance, evasion, archetype identity, color pie). For each, write the reason as 5-6 keywords or a short phrase (e.g. "ally colors, mana fixing, protects combo"), not a full sentence — this field is specifically for the small printed insert card, not general chat (the "Giving recommendations" section above still uses full sentences).
```

- [ ] **Step 3: Verify the text landed**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && grep -n "5-6 keywords" src/mcp-server.ts skills/jumpstart-deck-strategy/SKILL.md && grep -n "1-2 sentences on why this pairs" src/mcp-server.ts; echo "grep exit: $?"`

Expected: the first `grep` prints one matching line from each file; the second `grep` finds nothing (exits non-zero, so `grep exit: 1`), confirming the old sentence-based instruction is gone.

- [ ] **Step 4: Commit**

```bash
git add src/mcp-server.ts skills/jumpstart-deck-strategy/SKILL.md
git commit -m "feat: condense insert-card pairing reasons to keyword tags"
```

---

### Task 6: Regenerate `data/marvel.json` and verify end-to-end

**Files:**
- Modify: `data/marvel.json` (regenerated output)

**Interfaces:**
- Consumes: everything from Tasks 1-4 (oracle text fetch, batched Sonnet description generation, unified orchestration).
- Produces: updated `data/marvel.json` consumed by `src/mcp-server.ts` at request time (unchanged reader code).

**Precondition:** `ANTHROPIC_API_KEY` must be set in the shell for this task only. If it isn't already exported, ask the user for it before running Step 1 — do not hardcode or echo the key anywhere.

- [ ] **Step 1: Run the regeneration**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx scripts/refresh-data.ts "Marvel Super Heroes"`

Expected: stderr progress logs ending in `Baked 51 themes to data/marvel.json` (theme count should match the current file's `themeCount` — confirm with `jq .themeCount data/marvel.json` on the pre-existing file beforehand if you want an exact number to compare against).

- [ ] **Step 2: Confirm valid JSON and unchanged theme count**

Run: `jq -e '.themeCount == (.decks | length)' data/marvel.json`

Expected: `true` (the file parses and its declared count matches the actual array length).

- [ ] **Step 3: Spot-check the "Fantastic" theme names the real combo**

Run: `jq -r '.decks[] | select(.theme == "Fantastic") | .description' data/marvel.json`

Expected: a full paragraph (multiple sentences, not one short line) that explicitly mentions at least two of: Mister Fantastic, Human Torch, Invisible Woman, The Thing, and how they interact with The Fantastic Four's modes (Wall token / damage / counters / draw). If the paragraph is still generic or one sentence, treat this as a failed verification — re-check Task 3's prompt made it into the running code (Step 6 of Task 3 confirms load-time only, not prompt content) and re-run Step 1.

- [ ] **Step 4: Spot-check 2-3 other themes for length and no-fabrication behavior**

Run: `jq -r '.decks[] | select(.theme == "Wild" or .theme == "Thor" or .theme == "Marvelous") | "\(.theme): \(.description)"' data/marvel.json`

Expected: each is a full paragraph describing strategy/playstyle. Read them: confirm none invents a combo that isn't plausible from the theme's actual card list (cross-check a couple of card names against `jq '.decks[] | select(.theme=="Thor") | .cards[].title' data/marvel.json` if anything looks suspicious).

- [ ] **Step 5: Confirm the MCP server still serves the file correctly**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx -e "
import { readFileSync } from 'node:fs';
const baked = JSON.parse(readFileSync('data/marvel.json', 'utf8'));
console.log('series:', baked.series, 'themeCount:', baked.themeCount, 'decks:', baked.decks.length);
console.log('sample description length (chars):', baked.decks[0].description.length);
"`

Expected: `series: Marvel Super Heroes themeCount: 51 decks: 51` (or whatever the true count is) and a sample description length well over 200 characters (today's generic descriptions run roughly 100-160 characters; a real paragraph should be noticeably longer).

- [ ] **Step 6: Commit**

```bash
git add data/marvel.json
git commit -m "data: regenerate Marvel Super Heroes descriptions with oracle-text-grounded combos"
```

---

## Out of scope (per spec)

- Regenerating the other 5 series' `data/*.json` files.
- Persisting oracle text itself in baked data.
- Any change to `powerLevel` computation or pricing logic.
- Any change to the general conversational "Giving recommendations" guidance in `SKILL.md`.
