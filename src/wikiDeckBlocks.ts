// Some mtg.wiki pages render decklists via a semantic Scryfall-integration
// widget (<div class="ext-scryfall-deck">...) with a data-card-name attribute
// per card, instead of relying on the surrounding prose/table markup that
// discoverThemes/extractDecklist otherwise ask Claude to interpret. Where
// present, this markup is fully deterministic — parse it directly. Used for
// series whose decklists live inline on one page with no Decklists_-_Color
// subpages to discover (e.g. LOTR Jumpstart).

import type { Category, Card } from './types.js';

function decodeEntities(raw: string): string {
  return raw.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

export function parseScryfallDeckBlocks(html: string): { theme: string; categories: Category[] }[] {
  const chunks = html.split('<div class="ext-scryfall-deck">').slice(1);
  const decks: { theme: string; categories: Category[] }[] = [];

  for (const chunk of chunks) {
    const titleMatch = chunk.match(/<span class="ext-scryfall-decktitle">([^<]+)<\/span>/);
    if (!titleMatch) continue;
    const theme = decodeEntities(titleMatch[1].trim());

    const categories: Category[] = [];
    const sectionRe = /<div class="ext-scryfall-decksection">([\s\S]*?)<\/div>/g;
    let sectionMatch: RegExpExecArray | null;
    while ((sectionMatch = sectionRe.exec(chunk)) !== null) {
      const sectionHtml = sectionMatch[1];
      const nameMatch = sectionHtml.match(/<span class="ext-scryfall-decksectiontitle">([^<]+)<\/span>/);
      if (!nameMatch) continue;
      const name = decodeEntities(nameMatch[1].trim());

      const cards: Card[] = [];
      const entryRe = /<span class="ext-scryfall-deckcardcount">(\d+)<\/span>\s*<a[^>]*data-card-name="([^"]+)"/g;
      let entryMatch: RegExpExecArray | null;
      while ((entryMatch = entryRe.exec(sectionHtml)) !== null) {
        cards.push({ qty: parseInt(entryMatch[1], 10), name: decodeEntities(entryMatch[2]) });
      }
      if (cards.length > 0) categories.push({ name, cards });
    }
    if (categories.length > 0) decks.push({ theme, categories });
  }

  return decks;
}

// Parses a "Name | Color | Theme | Rare" wikitable (mana-symbol image per
// row) into base-theme-name -> color. Deck titles carry a numbered variant
// suffix ("Journey 1") that this table's Name column doesn't ("Journeys") —
// matchBaseThemeColor below handles that mismatch with prefix matching.
export function parseThemeColors(html: string): Map<string, string> {
  const colorByName = new Map<string, string>();
  const rowRe = /<tr>\s*<td>([^<]+?)\s*<\/td>\s*<td>[\s\S]*?alt="(\w+) mana"/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    colorByName.set(m[1].trim(), m[2].trim());
  }
  return colorByName;
}

export function matchBaseThemeColor(deckTitle: string, colorByName: Map<string, string>): string {
  const base = deckTitle.replace(/\s+\d+$/, '').trim().toLowerCase();
  for (const [name, color] of colorByName) {
    const n = name.toLowerCase();
    if (n === base || n.startsWith(base) || base.startsWith(n)) return color;
  }
  return '';
}
