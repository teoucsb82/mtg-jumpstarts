// Published MCP server: serves baked-in static Jumpstart decklist data with
// live Scryfall pricing. Makes zero Claude API calls — no API key needed.
// Run: npx tsx src/mcp-server.ts (stdio transport, spawned by an MCP client)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { SERIES_NAMES, resolveSeriesSlug } from './series.js';
import { priceDecklists } from './pricing.js';
import { formatResultsJson } from './output.js';
import type { BakedSeries, PricedDecklist } from './types.js';

function loadBakedSeries(slug: string): BakedSeries {
  const dataPath = fileURLToPath(new URL(`../data/${slug}.json`, import.meta.url));
  const raw = readFileSync(dataPath, 'utf8');
  return JSON.parse(raw) as BakedSeries;
}

const server = new McpServer({ name: 'mtg-jumpstarts', version: '1.0.0' });

server.registerTool(
  'get_jumpstart_decklists',
  {
    title: 'Get Jumpstart decklists',
    description: 'Get all theme-pack decklists for an MTG Jumpstart-format series, with live Scryfall prices.',
    inputSchema: {
      series: z.enum(SERIES_NAMES).describe('Exact Jumpstart series name, e.g. "Avatar: The Last Airbender"'),
    },
  },
  async ({ series }) => {
    let slug: string;
    try {
      slug = resolveSeriesSlug(series);
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }

    let baked: BakedSeries;
    try {
      baked = loadBakedSeries(slug);
    } catch {
      return {
        content: [{ type: 'text' as const, text: `No baked data for "${series}" yet. Run scripts/refresh-data.ts to generate it.` }],
        isError: true,
      };
    }

    const priced: PricedDecklist[] = await priceDecklists(baked.decks);
    return { content: [{ type: 'text' as const, text: formatResultsJson(baked.series, priced) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
