// Attaches Scryfall USD prices to extracted decklists and assigns power tiers.
// Power tier is 1–5 stars, distributed on a z-score bell curve relative to the
// mean deck value of the series: most decks land at 3★, true outliers at 1★ or 5★.

import type { Decklist, PricedDecklist, PricedCategory, PricedCard } from './types.js';
import { fetchScryfallPrices } from './scryfall.js';

function zScoreTier(z: number): number {
  if (z < -1.5) return 1;
  if (z < -0.5) return 2;
  if (z < 0.5)  return 3;
  if (z < 1.5)  return 4;
  return 5;
}

export async function priceDecklists(decklists: Decklist[]): Promise<PricedDecklist[]> {
  const allNames = [...new Set(
    decklists.flatMap(d => d.categories.flatMap(cat => cat.cards.map(c => c.name)))
  )];

  console.error(`Looking up prices for ${allNames.length} unique cards via Scryfall...`);
  const priceMap = await fetchScryfallPrices(allNames);

  // First pass: price each deck
  const priced = decklists.map(decklist => {
    let deckTotal = 0;
    const categories: PricedCategory[] = decklist.categories.map(cat => {
      let categoryTotal = 0;
      const cards: PricedCard[] = cat.cards.map(card => {
        const unitPrice = priceMap.get(card.name) ?? null;
        if (unitPrice !== null) categoryTotal += unitPrice * card.qty;
        return { ...card, unitPrice };
      });
      deckTotal += categoryTotal;
      return { name: cat.name, cards, categoryTotal };
    });
    return {
      theme: decklist.theme,
      color: decklist.color ?? '',
      categories,
      deckTotal,
      description: decklist.description,
      recommendedPairings: decklist.recommendedPairings ?? [],
    };
  });

  // Second pass: z-score power tiers relative to this series
  const totals = priced.map(d => d.deckTotal);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const stdDev = Math.sqrt(totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length);

  return priced.map(d => ({
    ...d,
    powerTier: stdDev === 0 ? 3 : zScoreTier((d.deckTotal - mean) / stdDev),
  }));
}
