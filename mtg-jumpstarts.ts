// Entry point. Orchestrates the two-phase pipeline:
//   Phase 1 — discover all themes for the series (with URLs)
//   Phase 2 — extract each theme's decklists (in parallel)
// Then fetches Scryfall prices and prints formatted results.
//
// Run: npx tsx mtg-jumpstarts.ts "<series name>" (entry point stays at root)
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

import { buildSeriesUrl, fetchHtml, fetchSeriesPageWithFallback } from './src/fetch.js';
import { Semaphore } from './src/claude.js';
import {
  discoverThemes,
  isSamePageGrouped,
  extractDecklist,
  extractThemeFromPage,
  analyzeSynergies,
  mergeSynergies,
} from './src/agents.js';
import { priceDecklists } from './src/pricing.js';
import { printResultsJson, exportCsv, exportXlsx } from './src/output.js';
import type { Decklist, AgentSynergy } from './src/types.js';
import { normalizeColor } from './src/types.js';

async function main(): Promise<void> {
  const keyword = process.argv[2];
  const csvFlagIdx = process.argv.indexOf('--csv');
  const csvPath = csvFlagIdx !== -1 ? process.argv[csvFlagIdx + 1] : null;
  const xlsxFlagIdx = process.argv.indexOf('--xlsx');
  const xlsxPath = xlsxFlagIdx !== -1 ? process.argv[xlsxFlagIdx + 1] : null;

  if (!keyword) {
    console.error('Usage: npx tsx mtg-jumpstarts.ts "<series name>" [--csv <file>] [--xlsx <file>]');
    console.error('Examples:');
    console.error('  npx tsx mtg-jumpstarts.ts "Foundations Jumpstart"');
    console.error('  npx tsx mtg-jumpstarts.ts "Avatar: The Last Airbender" --csv avatar.csv');
    console.error('  npx tsx mtg-jumpstarts.ts "Marvel Super Heroes" --xlsx marvel.xlsx');
    process.exit(1);
  }

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
  //
  // Fetch all unique page URLs in parallel (cache prevents re-fetching).
  // Then dispatch extraction agents in parallel, gated by the semaphore.

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
    // Shared-page structure (Avatar, Marvel, Foundations):
    // Run one targeted agent call per theme — handles numbered variants.
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
    // Individual-page structure: one decklist per URL.
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

  // Attach color from theme discovery: match on exact name or numbered variant prefix
  // (e.g. Theme "Angels" → decklists "Angels 1", "Angels 2")
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

  const pricedDecklists = await priceDecklists(decklistsWithSynergies);
  printResultsJson(keyword, pricedDecklists);
  if (csvPath) exportCsv(keyword, pricedDecklists, csvPath);
  if (xlsxPath) exportXlsx(keyword, pricedDecklists, xlsxPath);
}

// Only run when invoked directly (not when imported as a module)
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch(err => { console.error(`Fatal: ${err.message}`); process.exit(1); });
}
