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

## CSV export

Add `--csv <file>` to write a flat CSV alongside the normal output:

```bash
npx tsx mtg-jumpstarts.ts "Avatar: The Last Airbender" --csv avatar.csv
```

One row per card. Columns:

| Series | Theme | Color | Type | Qty | Card | Unit Price | Line Total | Deck Total | Power Level |
|--------|-------|-------|------|-----|------|------------|------------|------------|-------------|
| Avatar: The Last Airbender | Aang | white | Creatures | 1 | Aang, Airbending Master | 8.24 | 8.24 | 11.56 | 3 |

- **Color** — `white` / `blue` / `black` / `red` / `green` / `multi`
- **Power Level** — raw number 1–5 (sortable/filterable in Sheets)
- Prices are bare numbers (no `$`) so spreadsheet formulas work
- Cards with unknown prices have empty price cells

Import into Google Sheets via **File → Import → Upload**.

## Piping output

Progress goes to stderr; card data goes to stdout — so you can redirect cleanly:

```bash
npx tsx mtg-jumpstarts.ts "Foundations Jumpstart" > results.txt
npx tsx mtg-jumpstarts.ts "Foundations Jumpstart" 2>/dev/null  # suppress progress
```
