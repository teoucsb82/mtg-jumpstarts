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
import { formatDeckInsertCard } from './deckInsertCard.js';
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

server.registerTool(
  'format_deck_insert_card',
  {
    title: 'Format deck insert card',
    description: 'Format the front and back text for a printable double-sided Jumpstart deck insert card (2"x3.5", portrait), given one theme\'s deck data (including per-card rarity/colors, as returned by get_jumpstart_decklists) and its suggested pairings. Reason about the pairings yourself (see the jumpstart-deck-strategy skill) before calling this — it only formats, it does not choose pairings. Returns 2 text blocks (front, back) — relay each verbatim in its own fenced code block, do not paraphrase into prose.',
    inputSchema: {
      series: z.string().optional().describe('Series name shown on the card, e.g. "Marvel Super Heroes"'),
      theme: z.string().describe('Exact theme name'),
      color: z.enum(['white', 'blue', 'black', 'red', 'green', 'multi']),
      playstyle: z.array(z.string()).min(1).max(3).describe('Keyword tags for overall playstyle, e.g. ["Big creatures", "Buffs"] — pass through from get_jumpstart_decklists verbatim, do not rewrite'),
      tips: z.array(z.string()).min(1).max(5).describe('Short punchy strategy/combo bullets (1-6 words each) — pass through from get_jumpstart_decklists verbatim, do not rewrite'),
      powerLevel: z.number().int().min(1).max(5),
      cards: z.array(z.object({
        title: z.string(),
        type: z.string().describe('Category, e.g. "Creatures", "Lands"'),
        qty: z.number().int(),
        rarity: z.string().nullable().describe('Scryfall rarity, e.g. "rare", or null if unknown'),
        colors: z.array(z.string()).describe('Scryfall color letters, e.g. ["W"]; empty array = colorless'),
      })).min(1).describe('Full 20-card decklist for this theme'),
      pairings: z.array(z.object({
        theme: z.string(),
        color: z.string(),
        reason: z.string().describe('5-6 keywords or a short phrase capturing the playstyle synergy (e.g. "ally colors, mana fixing, protects combo") — not a full sentence'),
      })).min(1).max(5).describe('Up to 5 suggested pairing themes from the same series'),
    },
  },
  async (input) => {
    const { front, back } = formatDeckInsertCard(input);
    return { content: [{ type: 'text' as const, text: front }, { type: 'text' as const, text: back }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
