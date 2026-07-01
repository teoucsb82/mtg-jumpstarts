// Claude agents: each function is one agent call with a specific job.
// Phase 1: discover themes on the series page.
// Phase 2: extract decklists — either one per individual page, or per-theme
//          on a shared color-group page (handles numbered variants like Angels 1/Angels 2).

import Anthropic from '@anthropic-ai/sdk';
import type { Theme, Decklist } from './types.js';
import { stripHtml } from './fetch.js';
import { THEMES_TOOL, DECKLIST_TOOL, DECKLISTS_TOOL } from './tools.js';
import { Semaphore, withRetry, callAgent } from './claude.js';

// ─── Phase 1: Theme discovery ─────────────────────────────────────────────────

export async function discoverThemes(
  client: Anthropic,
  semaphore: Semaphore,
  html: string,
  seriesUrl: string,
): Promise<Theme[]> {
  // href attributes are stripped by stripHtml, so extract Decklists links first.
  // This gives the agent accurate URL→theme mappings without requiring it to
  // guess color-page assignments from dense, mixed table text.
  const linkRe = /href="(\/page\/[^"]*\/Decklists[^"#]*)(?:#([^"]*))?"[^>]*>([^<]+)<\/a>/gi;
  const extractedLinks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const [, path, anchor, label] = m;
    const url = `https://mtg.wiki${path}${anchor ? '#' + anchor : ''}`;
    extractedLinks.push(`${label.trim()}: ${url}`);
  }

  const linksBlock = extractedLinks.length > 0
    ? `DECKLIST LINKS FOUND ON PAGE:\n${extractedLinks.join('\n')}\n\n`
    : '';

  const content = `${linksBlock}${stripHtml(html)}`;

  const instructions = `You are parsing a Magic: The Gathering Jumpstart series wiki page.
The series page URL is: ${seriesUrl}

${extractedLinks.length > 0
  ? `Decklist page links have been pre-extracted above (DECKLIST LINKS FOUND ON PAGE). Use those exact URLs.
Prefer anchor URLs (e.g. /Decklists_-_White#Angels) over top-level color-page links (/Decklists_-_White) — the anchors give us individual theme names.`
  : `Find all navigation links that point to pages with "Decklists" in the URL.
IMPORTANT — return URLs EXACTLY as they appear, including any #anchor fragments.
Example of correct URL: "${seriesUrl}/Decklists_-_White#Angels"
Do NOT guess or construct URLs.`}

Use the report_themes tool to return all theme names and their exact URLs.

PAGE CONTENT:`;

  const result = await withRetry(
    () => callAgent<{ themes: Theme[] }>(client, semaphore, THEMES_TOOL, instructions, content, 4096),
    'theme discovery',
  );

  if (!result.themes?.length) throw new Error('No themes returned by agent');

  // If the page uses color/anchor-grouped structure (Avatar, Marvel, Foundations),
  // the agent returns URLs like /Decklists_-_White#Angels.
  // Strip the fragment to get the fetchable base URL, use the anchor as the theme name,
  // and deduplicate — but keep each UNIQUE theme (not just unique base URLs).
  const hasAnchors = result.themes.some(t => t.url.includes('#'));

  if (hasAnchors) {
    const seen = new Set<string>();
    return result.themes
      .map(t => {
        const [baseUrl, fragment] = t.url.split('#');
        // Anchor name → theme name (e.g. "Angels_1" → "Angels 1", "At_the_Zoo" → "At the Zoo")
        // Also decode basic HTML entities that survive href extraction (e.g. N&#39;er-do-wells → N'er-do-wells)
        const name = fragment
          ? fragment.replace(/_/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
          : t.name;
        const color = baseUrl.match(/Decklists_-_(White|Blue|Black|Red|Green|Other)/i)?.[1] ?? '';
        return { name, url: baseUrl, color };
      })
      .filter(t => {
        const key = `${t.name}::${t.url}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  // No anchors: use URLs as-is, constructing any that are missing the /Decklists_- path
  return result.themes.map(theme => {
    const url = theme.url.includes('/Decklists_-_')
      ? theme.url
      : `${seriesUrl}/Decklists_-_${theme.name.replace(/\s+/g, '_')}`;
    const color = url.match(/Decklists_-_(White|Blue|Black|Red|Green|Other)/i)?.[1] ?? '';
    return { ...theme, url, color };
  });
}

// ─── Grouping detection ───────────────────────────────────────────────────────
// When multiple themes share the same URL, they live on a shared page (color-grouped
// series like Avatar, Marvel, Foundations). We use targeted per-theme extraction
// instead of trying to extract everything from the page in one shot.

export function isSamePageGrouped(themes: Theme[]): boolean {
  if (themes.length <= 1) return false;
  const urls = new Set(themes.map(t => t.url));
  return urls.size < themes.length;
}

// ─── Targeted per-theme extraction (shared-page series) ──────────────────────
// Extracts all decklists for ONE named theme from a page that contains many themes.
// Handles numbered variants: "Angels" may return [Angels 1, Angels 2] as separate decklists.
// One call per theme is far more reliable than "extract everything at once" on large pages.

export async function extractThemeFromPage(
  client: Anthropic,
  semaphore: Semaphore,
  theme: Theme,
  html: string,
): Promise<Decklist[]> {
  const content = stripHtml(html);
  const instructions = `You are parsing a Magic: The Gathering Jumpstart wiki page.
Find and extract ONLY the decklists for the theme named "${theme.name}".

IMPORTANT — numbered variants: some themes have multiple versions (e.g. "${theme.name} 1",
"${theme.name} 2"). If you see these, treat each numbered version as a completely SEPARATE
20-card decklist and include ALL of them.

Ignore every other theme on this page. Return only decklists for "${theme.name}".

For each decklist, also write a 1-2 sentence description of how the deck plays (e.g. "big creatures",
"spell heavy", "lots of tokens") based on the cards in it.

Use the report_decklists tool to return the decklist(s) you find.

PAGE CONTENT:`;

  const result = await withRetry(
    () => callAgent<{ decklists: Decklist[] }>(client, semaphore, DECKLISTS_TOOL, instructions, content, 4096),
    theme.name,
  );

  return result.decklists ?? [];
}

// ─── Single decklist extraction (individual-page series) ─────────────────────
// Used when each theme has its own unique URL (no sharing). One agent per page.

export async function extractDecklist(
  client: Anthropic,
  semaphore: Semaphore,
  theme: Theme,
  html: string,
): Promise<Decklist> {
  const content = stripHtml(html);
  const instructions = `You are parsing a Magic: The Gathering Jumpstart decklist wiki page for theme "${theme.name}".
Extract the theme name and all cards grouped by category (Creatures, Instants, Sorceries,
Enchantments, Artifacts, Planeswalkers, Lands, etc.). Preserve category order as shown.
Use qty=1 for any card with no explicit quantity listed.

Also write a 1-2 sentence description of how the deck plays (e.g. "big creatures", "spell heavy",
"lots of tokens") based on the cards you extracted.

Use the report_decklist tool to return the structured decklist.

PAGE CONTENT:`;

  return withRetry(
    () => callAgent<Decklist>(client, semaphore, DECKLIST_TOOL, instructions, content, 4096),
    theme.name,
  );
}
