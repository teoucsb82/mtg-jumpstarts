# mtg-jumpstarts

CLI tool that scrapes [mtg.wiki](https://mtg.wiki) to extract decklists for any MTG Jumpstart series, then fetches live USD prices from Scryfall.

## Quickstart

```bash
# Install dependencies
npm install

# Run
npx tsx mtg-jumpstarts.ts "<series name>"
```

**Examples:**

```bash
npx tsx mtg-jumpstarts.ts "Foundations Jumpstart"
npx tsx mtg-jumpstarts.ts "Avatar: The Last Airbender"
npx tsx mtg-jumpstarts.ts "Marvel"
```

## Requirements

- Node.js 18+
- An Anthropic API key (Claude extracts decklists from wiki HTML)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## What it does

1. Finds the series page on mtg.wiki
2. Discovers all theme names and their URLs
3. Fetches each theme page in parallel
4. Uses Claude to extract the decklist from the HTML
5. Looks up live Scryfall prices for every card
6. Prints results to stdout (progress to stderr, so output is pipeable)

## Output

```
=== FOUNDATIONS JUMPSTART ===
Found 65 themes.

--- Angels ---
Creatures (8 cards)  $4.21
  2x Serra Angel  $0.25 ea  $0.50
  ...
[20 cards total | Deck value: $6.43 | Power: Mid]
```

Power tiers: **Budget** (< $5) · **Mid** ($5–$15) · **Premium** (> $15)

## Piping output

Progress goes to stderr; card data goes to stdout — so you can redirect cleanly:

```bash
npx tsx mtg-jumpstarts.ts "Foundations Jumpstart" > results.txt
npx tsx mtg-jumpstarts.ts "Foundations Jumpstart" 2>/dev/null  # suppress progress
```
