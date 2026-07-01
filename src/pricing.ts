// Attaches Scryfall USD prices to baked decklists and assigns power levels.
// Power level is 1–5, distributed on a z-score bell curve relative to the
// mean deck value of the series: most decks land at 3, true outliers at 1 or 5.

import type { BakedDecklist, PricedDecklist, PricedCard } from './types.js';
import { fetchScryfallCardData } from './scryfall.js';

function zScoreTier(z: number): number {
  if (z < -1.5) return 1;
  if (z < -0.5) return 2;
  if (z < 0.5)  return 3;
  if (z < 1.5)  return 4;
  return 5;
}

export async function priceDecklists(decklists: BakedDecklist[]): Promise<PricedDecklist[]> {
  const allNames = [...new Set(decklists.flatMap(d => d.cards.map(c => c.title)))];

  console.error(`Looking up prices for ${allNames.length} unique cards via Scryfall...`);
  const cardDataMap = await fetchScryfallCardData(allNames);

  const priced = decklists.map(decklist => {
    let deckTotal = 0;
    const cards: PricedCard[] = decklist.cards.map(card => {
      const info = cardDataMap.get(card.title);
      const unitPrice = info?.price ?? null;
      const lineTotal = unitPrice !== null ? unitPrice * card.qty : null;
      if (lineTotal !== null) deckTotal += lineTotal;
      return {
        title: card.title,
        type: card.type,
        qty: card.qty,
        unitPrice,
        lineTotal,
        rarity: info?.rarity ?? null,
        colors: info?.colors ?? [],
      };
    });
    const cardCount = cards.reduce((sum, c) => sum + c.qty, 0);

    return {
      theme: decklist.theme,
      color: decklist.color,
      description: decklist.description,
      playstyle: decklist.playstyle,
      tips: decklist.tips,
      cards,
      cardCount,
      deckTotal,
    };
  });

  const totals = priced.map(d => d.deckTotal);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const stdDev = Math.sqrt(totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length);

  return priced.map(d => ({
    ...d,
    powerLevel: stdDev === 0 ? 3 : zScoreTier((d.deckTotal - mean) / stdDev),
  }));
}
