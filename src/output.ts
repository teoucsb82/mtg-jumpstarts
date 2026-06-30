// Formats and prints results to stdout. Progress messages go to stderr
// so that stdout remains clean (pipeable to jq, files, etc.).

import type { PricedDecklist } from './types.js';

export function printResults(keyword: string, decklists: PricedDecklist[]): void {
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  console.log(`\n=== ${keyword.toUpperCase()} JUMPSTART ===`);
  console.log(`Found ${decklists.length} themes.\n`);

  for (const decklist of decklists) {
    const totalCards = decklist.categories.reduce(
      (sum, cat) => sum + cat.cards.reduce((s, c) => s + c.qty, 0), 0,
    );
    const countWarning = totalCards !== 20 ? ` ⚠ ${totalCards} cards (expected 20)` : '';
    console.log(`--- ${decklist.theme} ---${countWarning}`);

    for (const cat of decklist.categories) {
      const catCards = cat.cards.reduce((s, c) => s + c.qty, 0);
      const catPrice = cat.categoryTotal > 0 ? `  ${fmt(cat.categoryTotal)}` : '';
      console.log(`${cat.name} (${catCards} cards)${catPrice}`);

      for (const card of cat.cards) {
        const lineTotal = card.unitPrice !== null ? card.unitPrice * card.qty : null;
        const priceCol = card.unitPrice !== null
          ? `  ${fmt(card.unitPrice)} ea  ${fmt(lineTotal!)}`
          : '  (price unknown)';
        console.log(`  ${card.qty}x ${card.name}${priceCol}`);
      }
    }

    console.log(
      `[${totalCards} cards total | Deck value: ${fmt(decklist.deckTotal)} | Power: ${decklist.powerTier}]`,
    );
    console.log('');
  }
}
