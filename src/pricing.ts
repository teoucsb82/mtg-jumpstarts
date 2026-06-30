// Attaches Scryfall USD prices to extracted decklists, flattens cards into one
// array per deck, and assigns power levels. Power level is 1–5 stars, distributed
// on a z-score bell curve relative to the mean deck value of the series: most
// decks land at 3, true outliers at 1 or 5.

import type { Decklist, PricedDecklist, PricedCard } from './types.js';
import { normalizeColor } from './types.js';
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

  // First pass: flatten categories into cards, price each deck
  const priced = decklists.map(decklist => {
    let deckTotal = 0;
    let cardCount = 0;
    const cards: PricedCard[] = decklist.categories.flatMap(cat =>
      cat.cards.map(card => {
        const unitPrice = priceMap.get(card.name) ?? null;
        const lineTotal = unitPrice !== null ? unitPrice * card.qty : null;
        if (lineTotal !== null) deckTotal += lineTotal;
        cardCount += card.qty;
        return { title: card.name, type: cat.name, qty: card.qty, unitPrice, lineTotal };
      }),
    );

    if (cardCount !== 20) {
      console.error(`  ⚠ ${decklist.theme}: ${cardCount} cards (expected 20)`);
    }

    return {
      theme: decklist.theme,
      color: normalizeColor(decklist.color ?? ''),
      description: decklist.description,
      cards,
      cardCount,
      deckTotal,
      synergies: decklist.synergies ?? [],
    };
  });

  // Second pass: z-score power levels relative to this series
  const totals = priced.map(d => d.deckTotal);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const stdDev = Math.sqrt(totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length);

  return priced.map(d => ({
    ...d,
    powerLevel: stdDev === 0 ? 3 : zScoreTier((d.deckTotal - mean) / stdDev),
  }));
}
