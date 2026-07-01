# Development

## Requirements

- Node.js 18+
- An Anthropic API key — only needed for `scripts/refresh-data.ts` (regenerating baked data below), never for running the MCP server itself.

## Local development

Register the server at project scope (this repo only, not your global Claude Code config):

```bash
claude mcp add mtg-jumpstarts -s project -- npx tsx src/mcp-server.ts
```

Restart Claude Code in this directory and approve the pending `mtg-jumpstarts` server when prompted. Then call the `get_jumpstart_decklists` tool with a `series` argument, e.g. "use the mtg-jumpstarts MCP tool to get Avatar: The Last Airbender decklists".

## Architecture

- `src/mcp-server.ts` — the published MCP server. Reads baked data from `data/<slug>.json`, attaches live Scryfall prices, computes `powerLevel`. Makes zero Claude API calls — no API key needed to run it.
- `scripts/refresh-data.ts` — maintainer-only script that (re)generates `data/<slug>.json`. Requires `ANTHROPIC_API_KEY`.
- `skills/jumpstart-deck-strategy/` — a bundled Claude Code skill giving the calling assistant Magic deckbuilding/color-pie knowledge, so it can reason about pairings live from the returned data instead of relying on a pre-computed (and less reliable) synergy feature.

## Regenerating baked data (maintainer only)

`data/<slug>.json` holds the static theme/card data (no prices) for each series. Regenerate it with:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx scripts/refresh-data.ts "<series name>"
```

`<series name>` must be one of the 6 supported series (see README). This scrapes mtg.wiki and writes `data/<slug>.json` — no prices, no console output beyond progress logged to stderr. Run it whenever a new series releases or mtg.wiki content changes; the published MCP server never runs this itself.

Most series use Claude to extract each theme's decklist from the wiki page. LOTR Jumpstart is the exception: its decklists are rendered by mtg.wiki in a fully deterministic markup format, so they're parsed directly (`src/wikiDeckBlocks.ts`) with no extraction call at all — only a single lightweight call to generate descriptions.

## Output shape

The `get_jumpstart_decklists` tool returns `{ series, themeCount, decks: [...] }`, where each deck has:

- **`color`** — one of `white` / `blue` / `black` / `red` / `green` / `multi`
- **`powerLevel`** — rated **1–5** on a z-score bell curve relative to the series mean — most decks land at 3, true outliers at 1 or 5. It's a price-based proxy, not a measure of competitive strength.
- A deck with a card count other than 20 logs a `⚠` warning to stderr when the underlying data was baked, not at request time.

## Publishing a new version

Bump `version` in `.claude-plugin/plugin.json` and tag a release for each published change — installers only get updates when that field changes:

```bash
git add .claude-plugin/plugin.json
git commit -m "chore: bump to vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```
