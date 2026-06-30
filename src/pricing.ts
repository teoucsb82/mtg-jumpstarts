// Attaches Scryfall USD prices to extracted decklists and assigns a power tier.

import type { Decklist, PricedDecklist, PricedCategory, PricedCard } from './types.js';
import { fetchScryfallPrices } from './scryfall.js';

export function powerTier(total: number): 'Budget' | 'Mid' | 'Premium' {
  if (total < 5) return 'Budget';
  if (total < 15) return 'Mid';
  return 'Premium';
}

export async function priceDecklists(decklists: Decklist[]): Promise<PricedDecklist[]> {
  // Deduplicate card names across all decklists so we make the minimum number
  // of Scryfall requests (many themes share basic lands and commons)
  const allNames = [...new Set(
    decklists.flatMap(d => d.categories.flatMap(cat => cat.cards.map(c => c.name)))
  )];

  console.error(`Looking up prices for ${allNames.length} unique cards via Scryfall...`);
  const priceMap = await fetchScryfallPrices(allNames);

  return decklists.map(decklist => {
    let deckTotal = 0;

    const pricedCategories: PricedCategory[] = decklist.categories.map(cat => {
      let categoryTotal = 0;
      const pricedCards: PricedCard[] = cat.cards.map(card => {
        const unitPrice = priceMap.get(card.name) ?? null;
        if (unitPrice !== null) categoryTotal += unitPrice * card.qty;
        return { ...card, unitPrice };
      });
      deckTotal += categoryTotal;
      return { name: cat.name, cards: pricedCards, categoryTotal };
    });

    return {
      theme: decklist.theme,
      categories: pricedCategories,
      deckTotal,
      powerTier: powerTier(deckTotal),
    };
  });
}
