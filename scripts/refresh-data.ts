// Maintainer-only: scrapes mtg.wiki and uses Claude to extract decklists for
// one Jumpstart series, then bakes the result (no prices) to data/<slug>.json.
// Requires ANTHROPIC_API_KEY. Run whenever a new series releases or wiki
// content changes — the published MCP server never runs this itself.
//
// Run: npx tsx scripts/refresh-data.ts "<series name>"
//
// Three wiki structures are handled transparently:
//
//  A. Individual pages (each theme has its own URL)
//     → extractDecklist per theme
//
//  B. Shared color-group pages (Avatar, Marvel, Foundations, etc.)
//     Multiple themes share one URL, accessed via #anchor on the series page.
//     Themes may have numbered variants (Angels 1, Angels 2).
//     → extractThemeFromPage per theme (targeted, one call per theme name)
//
//  C. Single-page inline decklists (LOTR Jumpstart) — every theme's decklist
//     lives directly on the series page itself, rendered via mtg.wiki's
//     semantic Scryfall-deck widget, with no Decklists_-_Color subpages to
//     discover or fetch. Parsed deterministically (src/wikiDeckBlocks.ts) —
//     no theme-discovery or card-extraction Claude calls at all, only a
//     single lightweight call for descriptions.

import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

import { buildSeriesUrl, fetchHtml, fetchSeriesPageWithFallback } from '../src/fetch.js';
import { Semaphore } from '../src/claude.js';
import {
  discoverThemes,
  isSamePageGrouped,
  extractDecklist,
  extractThemeFromPage,
  describeDecks,
} from '../src/agents.js';
import { parseScryfallDeckBlocks, parseThemeColors, matchBaseThemeColor } from '../src/wikiDeckBlocks.js';
import { bakeSeries } from '../src/baking.js';
import { SERIES_NAMES, resolveSeriesSlug, SERIES_WIKI_URL_OVERRIDES } from '../src/series.js';
import type { SeriesName } from '../src/series.js';
import type { Decklist } from '../src/types.js';
import { normalizeColor } from '../src/types.js';

async function main(): Promise<void> {
  const keyword = process.argv[2];

  if (!keyword) {
    console.error('Usage: npx tsx scripts/refresh-data.ts "<series name>"');
    console.error('Valid series:');
    for (const name of SERIES_NAMES) console.error(`  ${name}`);
    process.exit(1);
  }

  const slug = resolveSeriesSlug(keyword); // throws (with the valid-series list) on a bad input

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  const client = new Anthropic();
  const semaphore = new Semaphore(10); // max 10 concurrent Claude calls

  // ── Phase 1: Load the series page and discover all themes ───────────────────
  console.error(`\nSearching for "${keyword}" Jumpstart themes on mtg.wiki...`);
  let seriesHtml: string;
  let seriesUrl: string;
  // resolveSeriesSlug (above) already validated `keyword` is a real SeriesName.
  const primaryUrl = SERIES_WIKI_URL_OVERRIDES[keyword as SeriesName] ?? buildSeriesUrl(keyword);

  try {
    seriesHtml = await fetchHtml(primaryUrl);
    seriesUrl = primaryUrl;
    console.error(`Loaded: ${primaryUrl}`);
  } catch {
    console.error(`Primary URL failed, trying MediaWiki search...`);
    ({ html: seriesHtml, url: seriesUrl } = await fetchSeriesPageWithFallback(keyword));
    console.error(`Loaded: ${seriesUrl}`);
  }

  // ── Type C: single-page inline decklists (e.g. LOTR Jumpstart) ──────────────
  const inlineDecks = parseScryfallDeckBlocks(seriesHtml);
  let coloredDecklists: Decklist[];

  if (inlineDecks.length > 0) {
    console.error(`Found ${inlineDecks.length} decklists embedded directly on the series page.`);
    const themeColors = parseThemeColors(seriesHtml);

    console.error('Generating deck descriptions (one consolidated call)...');
    const descriptions = await describeDecks(client, semaphore, inlineDecks);

    coloredDecklists = inlineDecks.map(d => ({
      theme: d.theme,
      categories: d.categories,
      description: descriptions.get(d.theme) ?? '',
      color: normalizeColor(matchBaseThemeColor(d.theme, themeColors)),
    }));
  } else {
    coloredDecklists = await extractViaThemeDiscovery(client, semaphore, seriesHtml, seriesUrl);
  }

  // ── Bake: flatten + write static data, no prices ────────────────────────────
  const baked = bakeSeries(keyword, coloredDecklists);
  mkdirSync('data', { recursive: true });
  const outPath = `data/${slug}.json`;
  writeFileSync(outPath, JSON.stringify(baked, null, 2), 'utf8');
  console.error(`\nBaked ${baked.themeCount} themes to ${outPath}`);
}

// ── Type A/B: theme discovery (per-page or shared color-group pages) ─────────
async function extractViaThemeDiscovery(
  client: Anthropic,
  semaphore: Semaphore,
  seriesHtml: string,
  seriesUrl: string,
): Promise<Decklist[]> {
  const themes = await discoverThemes(client, semaphore, seriesHtml, seriesUrl);
  console.error(`Found ${themes.length} themes: ${themes.map(t => t.name).join(', ')}`);

  if (themes.length === 0) {
    console.error('No themes found. The wiki page may not list individual decklist subpages yet.');
    process.exit(1);
  }

  // ── Phase 2: Fetch pages + extract decklists ────────────────────────────────
  const uniqueUrls = [...new Set(themes.map(t => t.url))];
  console.error(`\nFetching ${uniqueUrls.length} page(s) in parallel...`);

  const pageHtml = new Map<string, string>();
  await Promise.all(uniqueUrls.map(async url => {
    try { pageHtml.set(url, await fetchHtml(url)); }
    catch (err) { console.error(`  ✗ fetch ${url}: ${err}`); }
  }));

  const reachable = themes.filter(t => pageHtml.has(t.url));

  let decklists: Decklist[];

  if (isSamePageGrouped(themes)) {
    console.error('Extracting decklists (one call per theme)...');
    const allResults = await Promise.all(
      reachable.map(theme =>
        extractThemeFromPage(client, semaphore, theme, pageHtml.get(theme.url)!)
          .then(results => {
            console.error(`  ✓ ${theme.name}: ${results.length} decklist(s)`);
            return results;
          })
          .catch(err => {
            console.error(`  ✗ ${theme.name}: ${err}`);
            return [] as Decklist[];
          }),
      ),
    );
    decklists = allResults.flat();
  } else {
    console.error('Extracting decklists (one call per page)...');
    const rawResults = await Promise.all(
      reachable.map(theme =>
        extractDecklist(client, semaphore, theme, pageHtml.get(theme.url)!)
          .then(d => { console.error(`  ✓ ${theme.name}`); return d; })
          .catch(err => { console.error(`  ✗ ${theme.name}: ${err}`); return null as Decklist | null; }),
      ),
    );
    decklists = rawResults.filter((d): d is Decklist => d !== null);
  }

  if (decklists.length === 0) {
    console.error('All decklist extractions failed.');
    process.exit(1);
  }

  return decklists.map(d => {
    const match = themes.find(t => d.theme === t.name || d.theme.startsWith(t.name + ' '));
    return { ...d, color: normalizeColor(match?.color ?? '') };
  });
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch(err => { console.error(`Fatal: ${err.message}`); process.exit(1); });
}
