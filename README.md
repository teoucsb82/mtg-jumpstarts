# mtg-jumpstarts

CLI tool that scrapes [mtg.wiki](https://mtg.wiki) to extract decklists for any MTG Jumpstart series, then fetches live USD prices from Scryfall.

## Quickstart

```bash
# Install dependencies
npm install

# Run
npx tsx mtg-jumpstarts.ts "<series name>"

# Export to CSV (for Google Sheets import)
npx tsx mtg-jumpstarts.ts "<series name>" --csv output.csv
```

**Examples:**

```bash
npx tsx mtg-jumpstarts.ts "Foundations Jumpstart"
npx tsx mtg-jumpstarts.ts "Avatar: The Last Airbender"
npx tsx mtg-jumpstarts.ts "Jumpstart 2022" --csv j22.csv
```

## Requirements

- Node.js 18+
- An Anthropic API key (Claude extracts decklists from wiki HTML)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## What it does

1. Finds the series page on mtg.wiki
2. Discovers all theme names, colors, and their URLs
3. Fetches each theme page in parallel
4. Uses Claude to extract the decklist from the HTML
5. Looks up live Scryfall prices for every card
6. Prints results to stdout (progress to stderr, so output is pipeable)

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

## CSV export

Add `--csv <file>` to write a flat CSV alongside the normal output:

```bash
npx tsx mtg-jumpstarts.ts "Avatar: The Last Airbender" --csv avatar.csv
```

One row per card. Columns:

| Series | Theme | Color | Type | Qty | Card | Unit Price | Line Total | Deck Total | Power Tier |
|--------|-------|-------|------|-----|------|------------|------------|------------|------------|
| Avatar: The Last Airbender | Aang | White | Creatures | 1 | Aang, Airbending Master | 8.24 | 8.24 | 11.56 | 3 |

- **Color** — `White` / `Blue` / `Black` / `Red` / `Green` / `Other`
- **Power Tier** — raw number 1–5 (sortable/filterable in Sheets)
- Prices are bare numbers (no `$`) so spreadsheet formulas work
- Cards with unknown prices have empty price cells

Import into Google Sheets via **File → Import → Upload**.

## Piping output

Progress goes to stderr; card data goes to stdout — so you can redirect cleanly:

```bash
npx tsx mtg-jumpstarts.ts "Foundations Jumpstart" > results.txt
npx tsx mtg-jumpstarts.ts "Foundations Jumpstart" 2>/dev/null  # suppress progress
```
