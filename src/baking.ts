// Converts raw Claude-extracted Decklist[] (nested categories) into flat,
// price-free BakedSeries data for storage in data/<slug>.json. Flags any
// deck whose card count isn't 20 at bake time — Claude's wiki extraction
// occasionally misses cards, and pricing (which used to catch this) no
// longer runs during baking, only later, per request, in the MCP server.

import type { Decklist, BakedSeries, BakedDecklist } from './types.js';
import { normalizeColor } from './types.js';

export function bakeSeries(series: string, decklists: Decklist[]): BakedSeries {
  const decks: BakedDecklist[] = decklists.map(d => {
    const cards = d.categories.flatMap(cat =>
      cat.cards.map(c => ({ title: c.name, type: cat.name, qty: c.qty })),
    );
    const cardCount = cards.reduce((sum, c) => sum + c.qty, 0);
    if (cardCount !== 20) {
      console.error(`  ⚠ ${d.theme}: ${cardCount} cards (expected 20)`);
    }
    return {
      theme: d.theme,
      color: normalizeColor(d.color ?? ''),
      description: d.description,
      playstyle: d.playstyle,
      tips: d.tips,
      cards,
    };
  });
  return { series, themeCount: decks.length, decks };
}
