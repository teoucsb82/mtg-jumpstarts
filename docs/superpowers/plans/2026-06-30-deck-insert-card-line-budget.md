# Deck Insert Card Line-Budget Reformat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `formatDeckInsertCard` in `src/deckInsertCard.ts` to pack both card faces into a fixed 46-column x 13-row grid (landscape 3.5"x2" card, Roboto Mono 8pt), instead of today's free-flowing/no-wrap text, and add `**bold**` markdown labels for copy/paste into markdown-aware apps.

**Architecture:** Pure function rewrite, no new files, no schema/type changes. Back face: filter to nonland cards, one per line, right-justified `(Rarity, Colors)` tag padded to column 46, with a per-line fallback that drops the tag (never the title) if a line would overflow. Front face: build lines in priority order (title+color+power merged, leaders, playstyle, tips, synergies), word-wrapped to 46 cols, with tips/synergies filled by a greedy budget-packer that reserves room for synergies so tips can't crowd them out entirely.

**Tech Stack:** TypeScript, run directly via `npx tsx` (no build step, no test framework in this repo — verification is done with disposable scripts run via tsx, deleted before committing).

## Global Constraints

- Physical target: landscape 3.5"w x 2"h card, **Roboto Mono 8pt hardcoded** font assumption.
- Fixed grid: **46 columns x 13 rows, per face** (front and back both).
- No card title is ever truncated. No card is ever dropped from the back face's nonland list.
- No blank spacer lines on either face — budget is too tight for whitespace-only lines.
- `**bold**` markdown syntax wraps section labels only (`**Playstyle:**`, `**Tips:**`,
  `**Synergies:**`, and the theme name `**{theme}**`) — literal asterisks in the plain-text
  output, meant to render as bold when pasted into a markdown-aware app.
- No new npm dependencies (no word-wrap library) — this repo has none for text processing.
- Full design rationale and verified line-count math: `docs/superpowers/specs/2026-06-30-deck-insert-card-line-budget-design.md`.

---

### Task 1: Back face — nonland-only, right-justified rarity/color tag

**Files:**
- Modify: `src/deckInsertCard.ts`

**Interfaces:**
- Consumes: existing exports/types in the file — `DeckInsertCardCard`, `DeckInsertCardInput`, `CATEGORY_ORDER` (from `./types.js`), existing `colorTag()`, `groupByCategory()`.
- Produces: `rarityLetter(rarity: string | null): string | null` and `formatCardLine(card: DeckInsertCardCard): string` — both module-private (not exported), consumed by Task 2 and by `formatDeckInsertCard`'s back-face construction.

- [ ] **Step 1: Write the failing verification script**

Create `verify-back-face.ts` at the repo root (`/Users/teodellamico/Code/mtg-jumpstarts/verify-back-face.ts`) — this is a throwaway script, not committed:

```ts
import { formatDeckInsertCard } from './src/deckInsertCard.js';

const input = {
  series: 'Marvel Super Heroes',
  theme: 'Speedy',
  color: 'red',
  playstyle: ['Haste aggro', 'Go-tall tempo', 'Unblockable damage'],
  tips: [
    'Start Quicksilver from opening hand',
    'Attack every turn with fresh haste creatures',
    'Whirlwind shuts down blockers on entering attackers',
    'Use Taxi Driver/Super Speed to grant haste',
    'Power up Quicksilver for double strike finisher',
  ],
  powerLevel: 2,
  cards: [
    { title: 'Masked Meower', type: 'Creatures', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Quicksilver, Brash Blur', type: 'Creatures', qty: 1, rarity: 'rare', colors: ['R'] },
    { title: 'Taxi Driver', type: 'Creatures', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Speed, Young Avenger', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['R'] },
    { title: 'Whirlwind, Killer Cyclone', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['R'] },
    { title: 'Volcanic Villain', type: 'Creatures', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'The Whizzer, Classic Speedster', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['R'] },
    { title: 'Living Lightning, Charged Up', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['R'] },
    { title: 'Lightning Strike', type: 'Instants', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Marvelous Melee', type: 'Instants', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Pick Up the Pace', type: 'Enchantments', qty: 1, rarity: 'rare', colors: ['R'] },
    { title: 'Super Speed', type: 'Enchantments', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Thriving Bluff', type: 'Lands', qty: 1, rarity: 'common', colors: [] },
    { title: 'Mountain', type: 'Lands', qty: 7, rarity: 'common', colors: [] },
  ],
  pairings: [
    { theme: 'Uncanny', color: 'green', reason: 'mutant aggro, tempo fit' },
    { theme: 'Lethal', color: 'black', reason: 'deathtouch protects hasty attackers' },
    { theme: 'HYDRA', color: 'black', reason: 'attacks-alone tempo, token match' },
  ],
};

const expectedBack = [
  'Masked Meower                           (C, R)',
  'Quicksilver, Brash Blur                 (R, R)',
  'Taxi Driver                             (C, R)',
  'Speed, Young Avenger                    (U, R)',
  'Whirlwind, Killer Cyclone               (U, R)',
  'Volcanic Villain                        (C, R)',
  'The Whizzer, Classic Speedster          (U, R)',
  'Living Lightning, Charged Up            (U, R)',
  'Lightning Strike                        (C, R)',
  'Marvelous Melee                         (C, R)',
  'Pick Up the Pace                        (R, R)',
  'Super Speed                             (C, R)',
].join('\n');

const { back } = formatDeckInsertCard(input as any);

if (back !== expectedBack) {
  console.error('FAIL: back face does not match expected output');
  console.error('--- actual ---');
  console.error(back);
  console.error('--- expected ---');
  console.error(expectedBack);
  process.exit(1);
}

const lineCount = back.split('\n').length;
if (lineCount > 13) {
  console.error(`FAIL: back face is ${lineCount} lines, exceeds 13-row budget`);
  process.exit(1);
}

for (const line of back.split('\n')) {
  if (line.length > 46) {
    console.error(`FAIL: line exceeds 46 chars (${line.length}): "${line}"`);
    process.exit(1);
  }
}

console.log(`PASS: back face matches expected output (${lineCount}/13 lines, all lines <=46 chars)`);
```

- [ ] **Step 2: Run it to confirm it fails against the current code**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx verify-back-face.ts`

Expected: `FAIL` — the current back face still includes category headers (`Creatures (8)`), lands, and full-word rarity (`Common, R`) instead of the new nonland-only, header-free, abbreviated, right-justified format. The mismatch confirms the script is actually exercising the change we're about to make.

- [ ] **Step 3: Implement the back-face rewrite**

In `src/deckInsertCard.ts`, add a `WIDTH` constant right after the existing `RARITY_RANK` declaration:

```ts
const RARITY_RANK: Record<string, number> = { mythic: 4, rare: 3, special: 3, bonus: 3, uncommon: 2, common: 1 };

const WIDTH = 46;
```

Add two new functions after `colorTag` (which stays unchanged) and before `selectLeaders`:

```ts
function rarityLetter(rarity: string | null): string | null {
  if (!rarity) return null;
  switch (rarity.toLowerCase()) {
    case 'common': return 'C';
    case 'uncommon': return 'U';
    case 'rare': case 'special': case 'bonus': return 'R';
    case 'mythic': return 'M';
    default: return null;
  }
}

function formatCardLine(card: DeckInsertCardCard): string {
  const qtyPrefix = card.qty > 1 ? `${card.qty}x ` : '';
  const title = `${qtyPrefix}${card.title}`;
  const letter = rarityLetter(card.rarity);
  if (letter === null) return title;
  const tag = `(${letter}, ${colorTag(card.colors)})`;
  if (title.length + 1 + tag.length > WIDTH) return title;
  return title + ' '.repeat(WIDTH - title.length - tag.length) + tag;
}
```

Replace the back-face construction inside `formatDeckInsertCard` — find this block:

```ts
  const categories = groupByCategory(cards);
  const back = [
    theme,
    '',
    ...categories.flatMap(({ name, cards: categoryCards }) => [
      `${name} (${categoryCards.reduce((sum, c) => sum + c.qty, 0)})`,
      ...categoryCards.map(c => {
        const qtyPrefix = c.qty > 1 ? `${c.qty}x ` : '';
        const rarity = c.rarity ? capitalize(c.rarity.toLowerCase()) : 'Unknown';
        return `  ${qtyPrefix}${c.title} (${rarity}, ${colorTag(c.colors)})`;
      }),
    ]),
  ].join('\n');
```

and replace it with:

```ts
  const nonland = groupByCategory(cards.filter(c => !c.type.startsWith('Lands'))).flatMap(g => g.cards);
  const back = nonland.map(formatCardLine).join('\n');
```

Also update the file's top-of-file comment block (the first ~11 lines) to reflect the new physical target — replace:

```ts
// Pure text formatter for a printable double-sided Jumpstart deck insert card
// (2"x3.5", portrait). No network/file/Claude API calls — layout only. Pairing
// reasoning happens upstream, in the calling Claude via the jumpstart-deck-strategy
// skill; leader-card selection is deterministic (highest rarity present) so it's
// handled here instead.
//
// Back-of-card lines are plain inline text ("title (Rarity, Colors)"), not a
// column-aligned table — portrait's ~19-23 usable characters at a readable font
// size can't hold a right-justified table without wrapping nearly every card,
// which grows the back face past what portrait's height can fit. See the design
// doc for the print-sizing math.
```

with:

```ts
// Pure text formatter for a printable double-sided Jumpstart deck insert card
// (3.5"x2", landscape). No network/file/Claude API calls — layout only. Pairing
// reasoning happens upstream, in the calling Claude via the jumpstart-deck-strategy
// skill; leader-card selection is deterministic (highest rarity present) so it's
// handled here instead.
//
// Both faces target a fixed 46-column x 13-row grid (Roboto Mono 8pt hardcoded).
// Back face lists nonland cards only, one per line, right-justified rarity/color
// tag — verified against every real baked deck to always fit within 13 rows. See
// the design doc for the full line-budget math.
```

- [ ] **Step 4: Run the verification script again to confirm it passes**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx verify-back-face.ts`

Expected: `PASS: back face matches expected output (12/13 lines, all lines <=46 chars)`

- [ ] **Step 5: Delete the throwaway script and commit**

```bash
rm verify-back-face.ts
git add src/deckInsertCard.ts
git commit -m "feat: back face lists nonland cards only, right-justified rarity/color tag"
```

---

### Task 2: Front face — merged title line, dynamic tips/synergies packer

**Files:**
- Modify: `src/deckInsertCard.ts`

**Interfaces:**
- Consumes: `WIDTH`, `rarityLetter()`, `colorLabel()`, `colorTag()` from Task 1 (same file).
- Produces: `wrapText(text: string, width?: number): string[]`, module-private, consumed only within `formatDeckInsertCard`.

- [ ] **Step 1: Write the failing verification script**

Create `verify-front-face.ts` at the repo root (throwaway, not committed) — same `input` object as Task 1's script:

```ts
import { formatDeckInsertCard } from './src/deckInsertCard.js';

const input = {
  series: 'Marvel Super Heroes',
  theme: 'Speedy',
  color: 'red',
  playstyle: ['Haste aggro', 'Go-tall tempo', 'Unblockable damage'],
  tips: [
    'Start Quicksilver from opening hand',
    'Attack every turn with fresh haste creatures',
    'Whirlwind shuts down blockers on entering attackers',
    'Use Taxi Driver/Super Speed to grant haste',
    'Power up Quicksilver for double strike finisher',
  ],
  powerLevel: 2,
  cards: [
    { title: 'Masked Meower', type: 'Creatures', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Quicksilver, Brash Blur', type: 'Creatures', qty: 1, rarity: 'rare', colors: ['R'] },
    { title: 'Taxi Driver', type: 'Creatures', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Speed, Young Avenger', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['R'] },
    { title: 'Whirlwind, Killer Cyclone', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['R'] },
    { title: 'Volcanic Villain', type: 'Creatures', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'The Whizzer, Classic Speedster', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['R'] },
    { title: 'Living Lightning, Charged Up', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['R'] },
    { title: 'Lightning Strike', type: 'Instants', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Marvelous Melee', type: 'Instants', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Pick Up the Pace', type: 'Enchantments', qty: 1, rarity: 'rare', colors: ['R'] },
    { title: 'Super Speed', type: 'Enchantments', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Thriving Bluff', type: 'Lands', qty: 1, rarity: 'common', colors: [] },
    { title: 'Mountain', type: 'Lands', qty: 7, rarity: 'common', colors: [] },
  ],
  pairings: [
    { theme: 'Uncanny', color: 'green', reason: 'mutant aggro, tempo fit' },
    { theme: 'Lethal', color: 'black', reason: 'deathtouch protects hasty attackers' },
    { theme: 'HYDRA', color: 'black', reason: 'attacks-alone tempo, token match' },
  ],
};

const expectedFront = [
  '**Speedy** — Marvel Super Heroes (Red) ●●○○○',
  'Leaders: Quicksilver, Brash Blur, Pick Up the',
  'Pace (R)',
  '**Playstyle:** Haste aggro, Go-tall tempo,',
  'Unblockable damage',
  '**Tips:** Start Quicksilver from opening hand',
  '- Attack every turn with fresh haste creatures',
  '- Whirlwind shuts down blockers on entering',
  'attackers',
  '- Use Taxi Driver/Super Speed to grant haste',
  '**Synergies:** Uncanny(G): mutant aggro, tempo',
  'fit',
].join('\n');

const { front } = formatDeckInsertCard(input as any);

if (front !== expectedFront) {
  console.error('FAIL: front face does not match expected output');
  console.error('--- actual ---');
  console.error(front);
  console.error('--- expected ---');
  console.error(expectedFront);
  process.exit(1);
}

const lineCount = front.split('\n').length;
if (lineCount > 13) {
  console.error(`FAIL: front face is ${lineCount} lines, exceeds 13-row budget`);
  process.exit(1);
}

console.log(`PASS: front face matches expected output (${lineCount}/13 lines)`);
```

- [ ] **Step 2: Run it to confirm it fails against the current code**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx verify-front-face.ts`

Expected: `FAIL` — the current front face still has separate Color/Power Level lines, blank spacer lines, no bold markers, and always shows all 5 tips and all 3 pairings regardless of budget.

- [ ] **Step 3: Implement the front-face rewrite**

In `src/deckInsertCard.ts`, add two constants next to `WIDTH` (added in Task 1):

```ts
const WIDTH = 46;
const HEIGHT = 13;
const SYNERGY_MIN_RESERVE = 2;
```

Add `wrapText` after `rarityLetter` (added in Task 1) and before `formatCardLine`:

```ts
function wrapText(text: string, width: number = WIDTH): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
```

Modify `selectLeaders` — change its last line from:

```ts
  return { names: [...new Set(top.map(c => c.title))], rarity: capitalize(top[0].rarity!.toLowerCase()) };
```

to:

```ts
  return { names: [...new Set(top.map(c => c.title))], rarity: top[0].rarity!.toLowerCase() };
```

(The rarity is now abbreviated at the front-face render site via `rarityLetter`, not spelled out here.)

Replace the front-face construction inside `formatDeckInsertCard` — find this block:

```ts
  const front = [
    ...(series ? [series] : []),
    theme,
    `Color: ${colorLabel(color)}`,
    `Power Level: ${powerCircles}`,
    ...(leaders ? [`${leaders.names.length > 1 ? 'Leaders' : 'Leader'}: ${leaders.names.join(', ')} (${leaders.rarity})`] : []),
    '',
    `Playstyle: ${playstyle.join(', ')}`,
    '',
    'Tips:',
    ...tips.map(t => `  - ${t}`),
    '',
    'Synergies:',
    ...pairings.map(p => `  ${p.theme} (${colorLabel(p.color)}) - ${p.reason}`),
  ].join('\n');
```

and replace it with:

```ts
  const frontLines: string[] = [];

  frontLines.push(...wrapText(`**${theme}**${series ? ` — ${series}` : ''} (${colorLabel(color)}) ${powerCircles}`));

  if (leaders) {
    const letter = rarityLetter(leaders.rarity);
    const label = leaders.names.length > 1 ? 'Leaders' : 'Leader';
    const tag = letter ? ` (${letter})` : '';
    frontLines.push(...wrapText(`${label}: ${leaders.names.join(', ')}${tag}`));
  }

  frontLines.push(...wrapText(`**Playstyle:** ${playstyle.join(', ')}`));

  const tipsCap = Math.max(0, HEIGHT - frontLines.length - SYNERGY_MIN_RESERVE);
  const tipLines: string[] = [];
  for (let i = 0; i < tips.length; i++) {
    const prefix = i === 0 ? '**Tips:** ' : '- ';
    const candidate = wrapText(`${prefix}${tips[i]}`);
    if (tipLines.length + candidate.length > tipsCap) break;
    tipLines.push(...candidate);
  }
  frontLines.push(...tipLines);

  const synergyBudget = Math.max(0, HEIGHT - frontLines.length);
  const synergyLines: string[] = [];
  for (let i = 0; i < pairings.length; i++) {
    const p = pairings[i];
    const prefix = i === 0 ? '**Synergies:** ' : '- ';
    const candidate = wrapText(`${prefix}${p.theme}(${colorLabel(p.color).charAt(0)}): ${p.reason}`);
    if (synergyLines.length + candidate.length > synergyBudget) break;
    synergyLines.push(...candidate);
  }
  frontLines.push(...synergyLines);

  const front = frontLines.join('\n');
```

- [ ] **Step 4: Run the verification script again to confirm it passes**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx verify-front-face.ts`

Expected: `PASS: front face matches expected output (12/13 lines)`

- [ ] **Step 5: Delete the throwaway script and commit**

```bash
rm verify-front-face.ts
git add src/deckInsertCard.ts
git commit -m "feat: front face merges title/color/power, packs tips/synergies to a 13-line budget"
```

---

### Task 3: Regenerate the README example and update its prose

**Files:**
- Modify: `README.md:122-186` (the "Printable deck insert cards" section)

**Interfaces:**
- Consumes: `formatDeckInsertCard` from `src/deckInsertCard.ts` (as rewritten in Tasks 1-2).

- [ ] **Step 1: Generate the new example output**

Create a throwaway script `regen-readme-example.ts` at the repo root:

```ts
import { formatDeckInsertCard } from './src/deckInsertCard.js';

const input = {
  series: 'Marvel Super Heroes',
  theme: 'Fantastic',
  color: 'multi',
  playstyle: ['Value/card-draw engine', 'Counter synergy', 'Go-wide defense into big finisher'],
  tips: [
    'Chain draws off Mister Fantastic',
    'Use Sue Storm for free Walls',
    'Grow The Thing before attacking',
    'Combo Thing Swing with pumped Heroes',
    'Ramp mana with Farseek/Terramorphic first',
  ],
  powerLevel: 3,
  cards: [
    { title: 'Human Torch, Johnny Storm', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['R'] },
    { title: 'H.E.R.B.I.E. Scout Unit', type: 'Creatures', qty: 1, rarity: 'common', colors: [] },
    { title: 'Mister Fantastic, Reed Richards', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['U'] },
    { title: 'Invisible Woman, Sue Storm', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['W'] },
    { title: 'The Thing, Ben Grimm', type: 'Creatures', qty: 1, rarity: 'uncommon', colors: ['G'] },
    { title: 'The Fantastic Four', type: 'Creatures', qty: 1, rarity: 'mythic', colors: ['G', 'R', 'U', 'W'] },
    { title: 'Wall Off', type: 'Instants', qty: 1, rarity: 'common', colors: ['W'] },
    { title: 'Fantastic Bounce', type: 'Instants', qty: 1, rarity: 'common', colors: ['U'] },
    { title: 'Inspired Fire', type: 'Instants', qty: 1, rarity: 'common', colors: ['R'] },
    { title: 'Thing Swing', type: 'Instants', qty: 1, rarity: 'common', colors: ['G'] },
    { title: 'Farseek', type: 'Sorceries', qty: 1, rarity: 'common', colors: ['G'] },
    { title: 'Daily Bugle Newspaper', type: 'Artifacts', qty: 1, rarity: 'uncommon', colors: [] },
    { title: 'Baxter Building', type: 'Lands', qty: 1, rarity: 'uncommon', colors: [] },
    { title: 'Thriving Grove', type: 'Lands', qty: 1, rarity: 'common', colors: [] },
    { title: 'Pym Technologies', type: 'Lands', qty: 1, rarity: 'common', colors: [] },
    { title: 'Forest', type: 'Lands', qty: 1, rarity: 'common', colors: [] },
    { title: 'Plains', type: 'Lands', qty: 1, rarity: 'common', colors: [] },
    { title: 'Island', type: 'Lands', qty: 1, rarity: 'common', colors: [] },
    { title: 'Mountain', type: 'Lands', qty: 1, rarity: 'common', colors: [] },
    { title: 'Terramorphic Expanse', type: 'Lands', qty: 1, rarity: 'common', colors: [] },
  ],
  pairings: [
    { theme: 'Trained', color: 'Green', reason: 'counter-doubling combos Sue Storm Walls' },
    { theme: 'Geniuses', color: 'Blue', reason: 'own Reed Richards, stacks card-draw engine' },
    { theme: 'Thor', color: 'Red', reason: 'damage-doubling turns Torch pings lethal' },
    { theme: 'Squadron', color: 'White', reason: 'Hero tribal buffs, exalted lone attacker' },
    { theme: 'Towering', color: 'Green', reason: 'ramp, power-4 payoffs, fixes 4-color mana' },
  ],
};

const { front, back } = formatDeckInsertCard(input as any);
console.log('=== FRONT ===');
console.log(front);
console.log(`(${front.split('\n').length} lines)`);
console.log();
console.log('=== BACK ===');
console.log(back);
console.log(`(${back.split('\n').length} lines)`);
```

The rarity/color values above are the same real Scryfall-sourced values already captured in the
current `README.md:158-181` example — reused directly rather than re-fetched, since they're
already-verified real data and this task only changes the *formatter*, not the underlying card
data.

- [ ] **Step 2: Run it and confirm both faces fit the budget**

Run: `cd /Users/teodellamico/Code/mtg-jumpstarts && npx tsx regen-readme-example.ts`

Expected: both `(N lines)` counts print `<= 13`. If either exceeds 13, stop and re-check Tasks 1-2
before proceeding — do not hand-edit the output to force it to fit.

- [ ] **Step 3: Update `README.md` with the generated output**

Replace `README.md:124` (the paragraph before the example) — find:

```
Ask for a "deck insert card" or "cheat sheet" and Claude reasons about pairings (same live logic as above), picks the deck's leader card(s) (its rare/mythic "face" card — ties are shown in full, not arbitrarily broken), and formats a double-sided, business-card-sized (2"x3.5", portrait) insert — front with theme, color, power level, leader, playstyle, tips, and synergies; back with the full decklist tagged by rarity and color. Real example, a trickier 4-color deck:
```

replace with:

```
Ask for a "deck insert card" or "cheat sheet" and Claude reasons about pairings (same live logic as above), picks the deck's leader card(s) (its rare/mythic "face" card — ties are shown in full, not arbitrarily broken), and formats a double-sided, business-card-sized (3.5"x2", landscape, Roboto Mono 8pt) insert, hard-wrapped to a fixed 46x13 character grid per face — front with theme, color, power level, leader, playstyle, tips, and synergies; back with the nonland decklist tagged by rarity and color. Real example, a trickier 4-color deck:
```

Replace the `**FRONT**` and `**BACK**` code blocks (`README.md:128-182`) with the exact output
printed by Step 2's script (copy the text between `=== FRONT ===` and the line-count line, and
between `=== BACK ===` and its line-count line — do not include the `(N lines)` annotations
themselves in the README).

Replace the closing line (`README.md:186`) — find:

```
Output is plain text, no price info, no forced line-wrapping — drop it into a design tool to lay out and print.
```

replace with:

```
Output is plain text with `**bold**` markdown labels (renders as bold when pasted into a markdown-aware app like Notion, Bear, or Google Docs), no price info, hard-wrapped and budget-packed to the fixed 46x13 grid — paste it straight in, no reflowing needed.
```

- [ ] **Step 4: Delete the throwaway script and commit**

```bash
rm regen-readme-example.ts
git add README.md
git commit -m "docs: regenerate deck insert card README example for new line-budget format"
```

---

### Task 4: Update the skill's physical-format description

**Files:**
- Modify: `skills/jumpstart-deck-strategy/SKILL.md`

**Interfaces:**
- None — documentation-only change, no code.

- [ ] **Step 1: Update the format description**

Find the line in the "Generating a deck insert card" section (currently reads, in the numbered
step 1's introductory sentence):

```
When asked for a "cheat sheet" or "deck insert card" for a theme (a printable double-sided 2"x3.5" card):
```

Replace with:

```
When asked for a "cheat sheet" or "deck insert card" for a theme (a printable double-sided 3.5"x2" landscape card, Roboto Mono 8pt, hard-wrapped to a fixed 46x13 character grid per face):
```

- [ ] **Step 2: Confirm the "relay verbatim" instruction still reads correctly**

Read `skills/jumpstart-deck-strategy/SKILL.md` around the "Relay the result verbatim" step
(step 4 of the same section) and confirm it doesn't need wording changes — it already says
"Do not summarize, paraphrase, merge into prose, or add/drop any line," which is still exactly
correct now that the tool itself guarantees budget-fit output. No edit needed here; this step is
just confirming, not changing.

- [ ] **Step 3: Commit**

```bash
git add skills/jumpstart-deck-strategy/SKILL.md
git commit -m "docs: update deck insert card skill description for landscape 46x13 format"
```
