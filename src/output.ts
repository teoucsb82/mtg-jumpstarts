// Formats and prints results to stdout. Progress messages go to stderr
// so that stdout remains clean (pipeable to jq, files, etc.).

import { writeFileSync } from 'node:fs';
import type { PricedDecklist } from './types.js';

function stars(tier: number): string {
  return '★'.repeat(tier) + '☆'.repeat(5 - tier);
}

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
      `[${totalCards} cards total | Deck value: ${fmt(decklist.deckTotal)} | Power: ${stars(decklist.powerTier)} (${decklist.powerTier}/5)]`,
    );
    console.log('');
  }
}

export function exportCsv(keyword: string, decklists: PricedDecklist[], filepath: string): void {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

  const rows: string[] = [
    ['Series', 'Theme', 'Color', 'Type', 'Qty', 'Card', 'Unit Price', 'Line Total', 'Deck Total', 'Power Tier']
      .map(esc).join(','),
  ];

  for (const deck of decklists) {
    for (const cat of deck.categories) {
      for (const card of cat.cards) {
        const lineTotal = card.unitPrice !== null
          ? (card.unitPrice * card.qty).toFixed(2)
          : '';
        rows.push([
          keyword,
          deck.theme,
          deck.color,
          cat.name,
          card.qty,
          card.name,
          card.unitPrice !== null ? card.unitPrice.toFixed(2) : '',
          lineTotal,
          deck.deckTotal.toFixed(2),
          deck.powerTier,
        ].map(esc).join(','));
      }
    }
  }

  writeFileSync(filepath, rows.join('\n'), 'utf8');
  console.error(`Exported ${decklists.length} decks to ${filepath}`);
}
