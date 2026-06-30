# MCP server + Claude Code plugin

## Problem

Today's CLI (`mtg-jumpstarts.ts`) calls the Anthropic API directly, billed to
the runner's own `ANTHROPIC_API_KEY`, on every invocation — including theme
discovery and decklist extraction from mtg.wiki HTML. That cost is paid per
run, and would be paid by anyone who installed a published version of this
tool too.

MCP has a "sampling" mechanism that lets a server delegate LLM calls back to
whatever client invoked it (so the caller's own usage pays, not the
server's). Research confirmed Claude Code does **not** implement MCP
sampling, and sampling is deprecated in the MCP spec as of 2026-07-28 — not
a viable path.

The actual fix is simpler: a Jumpstart series' theme names, colors, and card
lists are fixed once WotC prints the set. They never change. Only Scryfall
prices move over time. There's no reason to call Claude — or even rescrape
mtg.wiki — on every invocation at all.

## Goals

- Convert this repo into a Claude Code plugin bundling an MCP server,
  usable locally in this repo (project-scoped) and publishable to others
  via a self-hosted marketplace with semver versioning.
- The published MCP server makes **zero** Claude API calls and needs no API
  key — it serves baked-in static decklist data and fetches only live,
  keyless Scryfall prices.
- A separate maintainer-only script regenerates the baked data (reusing
  today's Claude-driven scrape/extract pipeline) when a new Jumpstart series
  releases or wiki content changes.
- `series` is a fixed enum validated against the known/baked set of
  Jumpstart-format products. Invalid names (`"Bloomburrow"`,
  `"Spider-Man"`) are rejected with a clear error, not silently scraped.
- First live test: generate `avatar.json` end-to-end through the new MCP
  tool.

## Non-goals

- No "scrape any arbitrary series on demand" path in the published server —
  deliberately removed from the public tool.
- No CI/automated data refresh. Refreshing baked data is a manual,
  maintainer-run step.
- No submission to Anthropic's curated plugin marketplace — self-hosted
  marketplace only (`/plugin marketplace add <you>/mtg-jumpstarts`).
- No build/bundle step — keep using `npx tsx` directly, consistent with
  today's repo.
- The MCP tool returns JSON only (no CSV/XLSX). The calling assistant can
  already write the returned JSON to a file; CSV/XLSX export is a possible
  future enhancement, not in scope here.

## Fixed series list (v1)

| Display name | Data file slug |
|---|---|
| Jumpstart | `jumpstart-2020` |
| Jumpstart 2022 | `jumpstart-2022` |
| Lord of the Rings: Tales of Middle-earth Jumpstart | `lotr` |
| Foundations Jumpstart | `foundations` |
| Avatar: The Last Airbender | `avatar` |
| Marvel Super Heroes | `marvel` |

`Jumpstart: Historic Horizons` is excluded — Arena-only digital release,
uses mechanics that don't exist in paper Magic, no Scryfall paper prices to
attach.

## Design

### 1. Baked data format (`data/<slug>.json`)

New types in `src/types.ts`, alongside the existing `Decklist`/`PricedCard`:

```ts
export type BakedCard = { title: string; type: string; qty: number };

export type BakedDecklist = {
  theme: string;
  color: Color;
  description: string;
  cards: BakedCard[];        // no price fields — priced live at request time
  synergies: Synergy[];
};

export type BakedSeries = {
  series: string;             // display name, e.g. "Avatar: The Last Airbender"
  themeCount: number;
  decks: BakedDecklist[];
};
```

One `data/<slug>.json` file per series, committed to the repo.

### 2. `scripts/refresh-data.ts` (maintainer-only, renamed from `mtg-jumpstarts.ts`)

- Same pipeline as today's CLI (`discoverThemes` → `extractDecklist` /
  `extractThemeFromPage` → `analyzeSynergies` / `mergeSynergies`), reusing
  `src/agents.ts` and `src/claude.ts` unchanged. Requires
  `ANTHROPIC_API_KEY`, same as today.
- Difference: skips the pricing step entirely (no `priceDecklists` call,
  no Scryfall lookups) and writes `BakedSeries` JSON to `data/<slug>.json`
  instead of printing or exporting CSV/XLSX.
- `series` argument is restricted to the same fixed display-name list the
  MCP server validates against (`src/series.ts`, see below) — can't
  accidentally bake an unsupported series under the wrong key.
- `--csv`/`--xlsx` flags are dropped from this script — those were views of
  *priced* data, which this script no longer produces.

### 3. Fixed series list module (`src/series.ts`)

Single source of truth shared by both `refresh-data.ts` and
`mcp-server.ts`:

```ts
export const SERIES: Record<string, string> = {
  'Jumpstart': 'jumpstart-2020',
  'Jumpstart 2022': 'jumpstart-2022',
  'Lord of the Rings: Tales of Middle-earth Jumpstart': 'lotr',
  'Foundations Jumpstart': 'foundations',
  'Avatar: The Last Airbender': 'avatar',
  'Marvel Super Heroes': 'marvel',
};
```

### 4. `src/mcp-server.ts` (new, published)

- Built with `@modelcontextprotocol/sdk` (new dependency), stdio transport.
- One tool: `get_jumpstart_decklists`
  - Input schema: `{ series: enum[...the 6 SERIES keys] }`.
  - Handler:
    1. Look up `SERIES[series]`; the JSON schema enum already blocks
       invalid values, but return a friendly error listing valid series if
       somehow reached with a bad value.
    2. Read + parse `data/<slug>.json`, resolved relative to the module
       (`import.meta.url`) so the same code works whether run from this
       repo directly or from an installed plugin's `${CLAUDE_PLUGIN_ROOT}`.
    3. Call the existing `priceDecklists` (`src/pricing.ts`, unchanged)
       against the baked `cards` to attach live Scryfall prices,
       `deckTotal`, and `powerLevel` (z-score calc already lives there).
    4. Return the same `PricedDecklist[]`-shaped JSON the CLI prints today,
       as the tool's text content.
- No `@anthropic-ai/sdk` import anywhere in this file or its transitive
  dependencies — keeps the published server key-free.

### 5. Plugin packaging

`.claude-plugin/plugin.json`:

```json
{
  "name": "mtg-jumpstarts",
  "description": "Get MTG Jumpstart series decklists with live Scryfall prices",
  "version": "1.0.0",
  "mcpServers": {
    "mtg-jumpstarts": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "${CLAUDE_PLUGIN_ROOT}/src/mcp-server.ts"]
    }
  }
}
```

`.claude-plugin/marketplace.json` — single-plugin marketplace entry
pointing at this repo, so others can run
`/plugin marketplace add <you>/mtg-jumpstarts` then `/plugin install`.

`package.json` gains `@modelcontextprotocol/sdk`. `@anthropic-ai/sdk` stays
as a dependency — used only by `scripts/refresh-data.ts`, never by the
published server.

### 6. Local install (this repo only)

Project-scoped `.mcp.json` at repo root (does not touch global `~/.claude`
config):

```json
{
  "mcpServers": {
    "mtg-jumpstarts": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "src/mcp-server.ts"]
    }
  }
}
```

This is the dev-loop path, separate from the plugin manifest (which uses
`${CLAUDE_PLUGIN_ROOT}`) — both point at the same `src/mcp-server.ts`.

### 7. First live test

1. `npx tsx scripts/refresh-data.ts "Avatar: The Last Airbender"` (uses
   the existing API key, one-time) → produces `data/avatar.json`.
2. Restart/reload so the project-scoped MCP server is picked up, then call
   `get_jumpstart_decklists({series: "Avatar: The Last Airbender"})`.
3. Confirm the result matches today's `PricedDecklist[]` shape with live
   prices populated; save it as `avatar.json`.

## Testing

- `data/<slug>.json` round-trips through `priceDecklists` without errors.
  Note: the stale `generated/foundations.txt` / `generated/jumpstart2022.txt`
  files predate the structured JSON output and have no `cards` array — they
  are **not** reusable as baked data and will need fresh bakes via
  `refresh-data.ts`.
- MCP tool rejects an invalid `series` (e.g. `"Bloomburrow"`) with a clear
  error instead of crashing.
- `npx tsx src/mcp-server.ts` starts cleanly over stdio and responds to
  `tools/list` / `tools/call`.
- End-to-end: `get_jumpstart_decklists({series: "Avatar: The Last Airbender"})`
  from a real Claude Code session in this repo, project-scoped, produces
  valid `avatar.json`.
