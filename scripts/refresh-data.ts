// Maintainer-only: scrapes mtg.wiki and uses Claude to extract decklists for
// one Jumpstart series, then bakes the result (no prices) to data/<slug>.json.
// Requires ANTHROPIC_API_KEY. Run whenever a new series releases or wiki
// content changes — the published MCP server never runs this itself.
//
// Run: npx tsx scripts/refresh-data.ts "<series name>"
//
// Two wiki structures are handled transparently:
//
//  A. Individual pages (each theme has its own URL)
//     → extractDecklist per theme
//
//  B. Shared color-group pages (Avatar, Marvel, Foundations, etc.)
//     Multiple themes share one URL, accessed via #anchor on the series page.
//     Themes may have numbered variants (Angels 1, Angels 2).
//     → extractThemeFromPage per theme (targeted, one call per theme name)

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
  analyzeSynergies,
  mergeSynergies,
} from '../src/agents.js';
import { bakeSeries } from '../src/baking.js';
import { SERIES_NAMES, resolveSeriesSlug } from '../src/series.js';
import type { Decklist, AgentSynergy } from '../src/types.js';
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
  const primaryUrl = buildSeriesUrl(keyword);

  try {
    seriesHtml = await fetchHtml(primaryUrl);
    seriesUrl = primaryUrl;
    console.error(`Loaded: ${primaryUrl}`);
  } catch {
    console.error(`Primary URL failed, trying MediaWiki search...`);
    ({ html: seriesHtml, url: seriesUrl } = await fetchSeriesPageWithFallback(keyword));
    console.error(`Loaded: ${seriesUrl}`);
  }

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

  const coloredDecklists: Decklist[] = decklists.map(d => {
    const match = themes.find(t => d.theme === t.name || d.theme.startsWith(t.name + ' '));
    return { ...d, color: normalizeColor(match?.color ?? '') };
  });

  // ── Phase 3: Cross-theme synergy recommendations ───────────────────────────
  console.error('\nAnalyzing cross-theme synergies...');
  const synergyInput = coloredDecklists.map(d => ({
    name: d.theme,
    color: d.color ?? '',
    description: d.description,
  }));
  const synergiesMap = await analyzeSynergies(client, semaphore, synergyInput).catch(err => {
    console.error(`  ✗ synergy analysis: ${err}`);
    return new Map<string, AgentSynergy[]>();
  });
  const decklistsWithSynergies = mergeSynergies(coloredDecklists, synergiesMap);

  // ── Bake: flatten + write static data, no prices ────────────────────────────
  const baked = bakeSeries(keyword, decklistsWithSynergies);
  mkdirSync('data', { recursive: true });
  const outPath = `data/${slug}.json`;
  writeFileSync(outPath, JSON.stringify(baked, null, 2), 'utf8');
  console.error(`\nBaked ${baked.themeCount} themes to ${outPath}`);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch(err => { console.error(`Fatal: ${err.message}`); process.exit(1); });
}
