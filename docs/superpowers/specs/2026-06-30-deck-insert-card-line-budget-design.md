# Deck insert card: fixed line-budget reformat

## Goal

Replace the current free-flowing text layout in `formatDeckInsertCard` with a format that
targets an exact, hardcoded physical constraint: **landscape 3.5"w x 2"h, Roboto Mono 8pt**,
which gives a fixed grid of **46 columns x 13 rows per face** (front and back are two faces of
the same physical card, so the same budget applies to both).

This supersedes the layout assumptions in `2026-06-30-deck-insert-card-design.md` and
`2026-06-30-front-card-playstyle-tips-design.md` (both still correct on data pipeline/fields —
`playstyle`/`tips`/`pairings`/rarity/colors all stay as-is). Only the **text layout algorithm**
changes: from "plain text, no wrapping, reflow in your own layout tool" to "hard-wrapped,
budget-packed to fit an exact 46x13 grid, with markdown bold for section labels."

Also adds copy/paste-friendly `**bold**` markdown syntax around section labels, so pasting the
output into a markdown-aware app (Notion, Bear, Google Docs w/ markdown paste, Obsidian, etc.)
renders real bold text — plain apps just show literal asterisks, which is an acceptable
trade-off given the ask.

## Why a fixed budget, not "reflow naturally"

The prior design's "no hard-wrapping" call was correct for its own assumption (portrait
2"x3.5", ~19-23 usable chars at a readable 9-11pt font — any fixed grid at that width was
worse than plain reflow). That assumption no longer holds: the font is now hardcoded (Roboto
Mono 8pt) and the card is landscape, giving a known, fixed 46x13 grid. With an exact character
grid, a budget-packing algorithm is *better* than free reflow: it guarantees every card fits
the same physical size, with no downstream tool needing to reflow anything.

## Verified against real data

All match math below was run against the current `data/*.json` (538 decks across 10 series),
not assumed.

- **Back face, nonland-only, one line per distinct card, no headers**: every deck has ≤13
  distinct nonland cards (min 11, max 13, mean ~12). **Every deck fits the 13-row budget with
  this exact rule** — verified, not approximate.
- **Front face, mandatory content only** (theme/color/power/leaders/playstyle, no tips/synergies
  yet): typically 5-6 lines, leaving 7-8 for tips+synergies.
- **Tips alone**, wrapped, regularly consume 7-10 of the 13 available lines (some tips run to 68
  chars and wrap to 2 lines) — confirmed this squeezes Synergies to 0-2 entries on most decks,
  which is why the packer explicitly reserves room for Synergies rather than letting Tips take
  everything.
- Dropping colors from the back tag was tried and reverted — colors stay in the tag
  (`(Rarity, Colors)`), because re-adding them was verified to barely affect fit: the tag itself
  averages ~6-8 chars, and only ~50-60 of 6434 real nonland cards (~0.8%, almost all synthetic
  "Random X or colorless rare/mythic" filler slots, not real named cards) are long enough to
  risk a line overflowing 46 chars once the tag is added.

## Physical spec (document this in README.md / DEVELOPMENT.md)

- Orientation: **landscape**, 3.5" wide x 2" tall.
- Font: **Roboto Mono, 8pt**, hardcoded assumption — not configurable, not measured per-user.
- Grid: **46 columns x 13 rows**, per face. Both front and back target this same grid (they're
  two faces of one physical card).

## Shared utilities (new, in `src/deckInsertCard.ts`)

```ts
const WIDTH = 46;
const HEIGHT = 13;
const SYNERGY_MIN_RESERVE = 2; // lines reserved for Synergies before Tips can claim them

function wrapText(text: string, width = WIDTH): string[]
```

`wrapText`: simple greedy word-wrap (split on spaces, pack words onto a line up to `width`,
break to a new line when the next word would overflow). No external library — this repo has no
other text-processing dependencies and the wrapping need is simple. **Implementation note**:
any `**bold**`-wrapped label (e.g. `**Tips:**`, `**Speedy**`) must never contain an internal
space that could get split across a wrap boundary and leave a dangling marker — construct bold
spans as single tokens (no embedded spaces) passed to `wrapText` as one word, never as a
multi-word phrase inside `**...**`.

```ts
function rarityLetter(rarity: string | null): string | null
```

`common` → `C`, `uncommon` → `U`, `rare`/`special`/`bonus` → `R` (same tier as today's
`RARITY_RANK` grouping), `mythic` → `M`, unknown/null → `null` (caller omits the tag entirely).

## Front face algorithm

Build lines in this fixed priority order, wrapping each logical field to `WIDTH`, tracking total
lines used against `HEIGHT`:

1. **Title line(s)**: `**{theme}**{series ? ' — ' + series : ''} ({ColorLabel}) {powerCircles}`
   — theme, series, color, and power level merged onto one wrapped run (previously 3-4 separate
   lines). `series` omitted the same way it is today.
2. **Leaders line(s)**: `{Leader(s)/Leader:} {names} ({rarityLetter})` — same singular/plural
   rule as today, rarity abbreviated via `rarityLetter`.
3. **Playstyle**: `**Playstyle:** {tags.join(', ')}`.
4. **Tips** (dynamic-packed): `**Tips:** {first tip}` then `- {tip}` for each subsequent tip, in
   given order. Budget: `remaining - SYNERGY_MIN_RESERVE` lines, where `remaining = HEIGHT -
   (lines used by 1-3)`. Fill greedily — add a tip only if its full wrapped line count fits
   within what's left of that budget; stop at the first tip that doesn't fit (never emit a
   partial/truncated tip).
5. **Synergies** (dynamic-packed): `**Synergies:** {first}` then `- {theme}({ColorInitial}):
   {reason}` for each subsequent pairing, in given order. Budget: whatever's left of `HEIGHT`
   after 1-4 actually used (this is `>= SYNERGY_MIN_RESERVE`, possibly more if Tips didn't use
   its whole allowance). Same greedy full-item-or-stop rule as Tips.

No blank spacer lines anywhere — bold labels are the only section separator; the budget doesn't
allow whitespace-only lines.

**Accepted edge case**: if mandatory content alone (1-2) ever exceeds `HEIGHT` (extremely long
leader ties with long names), Tips/Synergies both get skipped and the front runs over 13 lines
that one time. Not engineered around — no such case exists in current data.

## Back face algorithm

- **Nonland cards only** — drop the `Lands` category entirely (basics and nonbasics both).
- **No category headers, no title line** — just one line per distinct nonland card, in the
  existing `CATEGORY_ORDER` sort order (so creatures still list before instants, etc. — order
  is preserved, headers are just not printed).
- Per-card line: `{qty > 1 ? qty + 'x ' : ''}{title}`, left-aligned, with `(RarityLetter,
  Colors)` right-justified so the line totals exactly `WIDTH` characters (padded with spaces).
  `Colors` uses the existing `colorTag()` helper (already in the file) unchanged.
- **Per-line fallback**: if `title.length + 1 + tag.length > WIDTH` (or `rarityLetter` returns
  `null` for unknown rarity), drop the tag entirely for that one line and print the bare title,
  left-aligned, no padding. Never truncate a card's title.

```
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

**Accepted edge case**: if a future deck's nonland count ever exceeds 13 (has not happened in
any of the current 538 decks), the back runs one line over budget that one time. Not engineered
around — verified zero real occurrences.

## Worked examples (from real data, computed during design — not illustrative guesses)

**Front, "Speedy" (Marvel Super Heroes, typical case)**:
```
**Speedy** — Marvel Super Heroes (Red) ●●○○○
Leaders: Quicksilver, Brash Blur, Pick Up the
Pace (R)
**Playstyle:** Haste aggro, Go-tall tempo,
Unblockable damage
**Tips:** Start Quicksilver from opening hand
- Attack every turn with fresh haste creatures
- Whirlwind shuts down blockers on entering
attackers
- Use Taxi Driver/Super Speed to grant haste
**Synergies:** Uncanny(G): mutant aggro, tempo
fit
```
12/13 lines. 4 of 5 baked tips shown, 1 of the (example) 3 synergies shown — the 5th tip and
2 remaining synergies were cut for space, which is the packer working as designed.

**Back, "Speedy" (with real per-card rarity/colors)**:
```
Masked Meower                           (C, R)
Quicksilver, Brash Blur                 (R, R)
Taxi Driver                             (C, R)
Speed, Young Avenger                    (U, R)
Whirlwind, Killer Cyclone               (U, R)
Volcanic Villain                        (C, R)
The Whizzer, Classic Speedster          (U, R)
Living Lightning, Charged Up            (U, R)
Lightning Strike                        (C, R)
Marvelous Melee                         (C, R)
Pick Up the Pace                        (R, R)
Super Speed                             (C, R)
```
12/13 lines, right-justified, no headers, no lands.

## `SKILL.md` changes

"Generating a deck insert card" section: update the physical description from "printable
double-sided 2x3.5 card" to include the landscape/Roboto Mono 8pt/46x13 assumption, so Claude
knows the output is already budget-fit and should be relayed verbatim (no reflowing needed on
Claude's part — this is more true now than before, worth reinforcing in step 4's "relay
verbatim" instruction).

## `README.md` changes

- Update the `## Printable deck insert cards` prose: "business-card-sized (2"x3.5", portrait)"
  → "business-card-sized (3.5"x2", landscape, Roboto Mono 8pt), hard-wrapped to a fixed 46x13
  character grid per face."
- Replace the "Fantastic" front/back example output with real output from the new formatter
  (regenerate by running the actual tool, same as the existing example was captured — don't
  hand-write it).
- Update the closing line "Output is plain text, no price info, no forced line-wrapping" →
  reflects the new reality: plain text with markdown bold labels, hard-wrapped and budget-packed
  to the fixed grid.

## Testing

No test framework in this repo. Verify manually, same style as prior specs:

1. Run the MCP server locally, call `format_deck_insert_card` for "Speedy" (Marvel) with real
   Scryfall-sourced rarity/colors and a few hand-picked pairings — confirm output matches the
   worked example above (line count ≤13 on both faces, right-justified back tags, bold labels
   present, tips/synergies packed as designed).
2. Repeat for "Fantastic" (Marvel) — the 4-color, 6-creature/4-instant/1-sorcery/1-artifact deck
   already used in the README example — confirm the back face still fits (12 nonland cards) and
   multicolor tags (`G/R/U/W`) render correctly, including the mythic "The Fantastic Four" line
   (long title + long color tag — a real test of the per-line tag-drop fallback).
3. Spot-check one or two decks with tied leaders (multiple rares, long combined names) to
   confirm the Leaders line wraps correctly and doesn't blow the budget in the common case.
4. Confirm pasting the raw output into a markdown-aware app (e.g. Notion, or Google Docs with
   "paste and match markdown" if available) renders `**...**` spans as bold.

## Out of scope

- Any change to `playstyle`/`tips`/`pairings` data/generation, leader selection logic, or the
  MCP tool's input schema — this is a pure text-layout change inside `formatDeckInsertCard`.
- Mana curve, average CMC, or price info on either face — no room at this physical size, and
  price was already explicitly out of scope per the original design.
- The full paragraph `description` field on the front — no room; this was explored early in
  discussion under a mistaken "full page" assumption and dropped once the real 3.5"x2" landscape
  constraint was confirmed.
- Configurable font/size — Roboto Mono 8pt / 46x13 is a hardcoded assumption, not a parameter.
- Any fallback beyond "drop the tag, keep the title" on the back, or accepting an occasional
  1-line overflow on either face — no card is ever cut or truncated to force-fit the budget.
