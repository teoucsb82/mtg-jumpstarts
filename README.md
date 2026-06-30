# mtg-jumpstarts

MCP server that serves baked-in decklists for every MTG Jumpstart-format series, with live USD prices from Scryfall. Published as a Claude Code plugin — no Anthropic API key needed to use it.

A separate maintainer-only script (re)generates the baked decklist data by scraping [mtg.wiki](https://mtg.wiki) and using Claude to extract it.

## Supported series

Only these 6 series are valid — anything else (e.g. "Spider-Man", "Bloomburrow") is rejected with an error instead of being scraped on demand:

- `Jumpstart`
- `Jumpstart 2022`
- `Lord of the Rings: Tales of Middle-earth Jumpstart`
- `Foundations Jumpstart`
- `Avatar: The Last Airbender`
- `Marvel Super Heroes`

(`Jumpstart: Historic Horizons` is excluded — Arena-only digital release, no paper Scryfall prices.)

## Using the MCP server

### Local development

Register the server at project scope (this repo only, not your global Claude Code config):

```bash
claude mcp add mtg-jumpstarts -s project -- npx tsx src/mcp-server.ts
```

Restart Claude Code in this directory and approve the pending `mtg-jumpstarts` server when prompted. Then call the `get_jumpstart_decklists` tool with a `series` argument, e.g. "use the mtg-jumpstarts MCP tool to get Avatar: The Last Airbender decklists".

### Publish / install as a plugin

This repo is both the plugin and its own marketplace. Others install it with:

```bash
claude plugin marketplace add teoucsb82/mtg-jumpstarts
claude plugin install mtg-jumpstarts@mtg-jumpstarts
```

Bump `version` in `.claude-plugin/plugin.json` and tag a release for each published change — installers only get updates when that field changes.

## Output

The `get_jumpstart_decklists` tool returns structured JSON:

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
- A deck with a card count other than 20 logs a `⚠` warning to stderr when the underlying data was baked (see below), not at request time

## Regenerating baked data (maintainer only)

`data/<slug>.json` holds the static theme/card data (no prices) for each series. Regenerate it with:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx scripts/refresh-data.ts "<series name>"
```

`<series name>` must be one of the 6 supported series listed above. This scrapes mtg.wiki, uses Claude to extract each theme's decklist, and writes `data/<slug>.json` — no prices, no console output beyond progress logged to stderr. Run it whenever a new series releases or mtg.wiki content changes; the published MCP server never runs this itself.
