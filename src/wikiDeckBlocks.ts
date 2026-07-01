// Some mtg.wiki pages render decklists via a semantic Scryfall-integration
// widget (<div class="ext-scryfall-deck">...) with a data-card-name attribute
// per card, instead of relying on the surrounding prose/table markup that
// discoverThemes/extractDecklist otherwise ask Claude to interpret. Where
// present, this markup is fully deterministic — parse it directly. Used for
// series whose decklists live inline on one page with no Decklists_-_Color
// subpages to discover (e.g. LOTR Jumpstart).
//
// Several Jumpstart-on-a-set-page products (LOTR, March of the Machine,
// Brothers' War, ...) have widgets that don't list the full physical 20-card
// pack per theme, documented instead in a "This theme also comes with: ..."
// caption right after each widget, outside it. Two gaps are filled from that
// caption, both deliberately conservative (only act when the caption backs
// up an exact, already-observed shortfall — never invent a specific card):
//
// 1. A genuinely random rare/mythic slot (varies pack to pack, so the widget
//    can't and shouldn't list a specific card name for it) — represented as
//    a placeholder card. Wording varies by set: LOTR: "1x Random <Color>
//    ... rare or mythic rare"; March of the Machine: "... rare or mythic
//    rare from <Set> that's colorless or <color>."
// 2. Some sets' widgets only list a partial basic-land count (e.g. Brothers'
//    War: 6 in the widget, 8 is the real total; Dominaria United: 5 in the
//    widget, split across a "Stained Glass" line and a "Foil" line in the
//    caption). Topped up by summing every "N <adjective(s)> <BasicLand>"
//    mention in the caption — but only applied when that sum exactly closes
//    the widget+random-rare shortfall (in sets like LOTR/MOTM, the caption's
//    land mentions instead just call out finishes on lands the widget
//    already counted in full, so applying them there would double-count).

import type { Category, Card } from './types.js';

function decodeEntities(raw: string): string {
  return raw.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

// Returns a human-readable description of the random rare/mythic's color
// eligibility (e.g. "Green" or "White or colorless"), or null if this deck's
// chunk has no "also comes with" caption in a recognized phrasing.
function findRandomRareColor(chunk: string): string | null {
  const randomColor = chunk.match(/This theme also comes with:[\s\S]*?Random (\w+)[\s\S]*?rare or mythic rare/);
  if (randomColor) return randomColor[1];

  const colorlessOr = chunk.match(/This theme also comes with:[\s\S]*?rare or mythic rare[\s\S]*?colorless or (\w+)/);
  if (colorlessOr) return `${colorlessOr[1].charAt(0).toUpperCase()}${colorlessOr[1].slice(1)} or colorless`;

  return null;
}

function singularizeBasicLand(word: string): string {
  return word === 'Plains' ? word : word.replace(/s$/, '');
}

// Sums every "N <adjective(s)> <BasicLand>" mention in the caption (e.g. "1
// Stained Glass Plains" + "2 Foil Plains") and only returns a top-up when
// that sum exactly matches the shortfall already observed in the widget —
// see gap 2 above. Bails (returns null) if mentions name more than one land,
// since that means the caption isn't describing a single top-up we can
// confidently apply.
function findLandTopUp(chunk: string, shortfall: number): { name: string; qty: number } | null {
  if (shortfall <= 0) return null;
  const captionMatch = chunk.match(/This theme also comes with:([\s\S]*?)<h[234][ >]/);
  if (!captionMatch) return null;
  const caption = captionMatch[1];

  const basicLandRe = /(\d+)\s+(?:[A-Za-z]+\s+){0,3}(Plains|Islands?|Swamps?|Mountains?|Forests?)\b/g;
  let total = 0;
  let landName: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = basicLandRe.exec(caption)) !== null) {
    const name = singularizeBasicLand(match[2]);
    if (landName && landName !== name) return null;
    landName = name;
    total += parseInt(match[1], 10);
  }
  if (!landName || total !== shortfall) return null;
  return { name: landName, qty: total };
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

    // Trailing "also comes with" caption, between this deck's widget and the
    // next one (the chunk boundary), documents the random rare/mythic slot
    // and, for some sets, a partial-basic-land top-up (see file header).
    const widgetTotal = categories.flatMap(c => c.cards).reduce((sum, c) => sum + c.qty, 0);
    const randomRareColor = findRandomRareColor(chunk);
    if (randomRareColor) {
      categories.push({
        name: 'Random Rare',
        cards: [{ qty: 1, name: `Random ${randomRareColor} rare/mythic (varies by pack)` }],
      });
    }

    const shortfall = 20 - widgetTotal - (randomRareColor ? 1 : 0);
    const topUp = findLandTopUp(chunk, shortfall);
    if (topUp) {
      const landCategory = categories.find(c => /^lands?$/i.test(c.name));
      const existingCard = landCategory?.cards.find(c => c.name === topUp.name);
      if (existingCard) existingCard.qty += topUp.qty;
      else if (landCategory) landCategory.cards.push({ qty: topUp.qty, name: topUp.name });
      else categories.push({ name: 'Lands', cards: [{ qty: topUp.qty, name: topUp.name }] });
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
