// Formats and prints results to stdout. Progress messages go to stderr
// so that stdout remains clean (pipeable to jq, files, etc.).

import { writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type { PricedDecklist } from './types.js';

export function formatResultsJson(keyword: string, decklists: PricedDecklist[]): string {
  return JSON.stringify({ series: keyword, themeCount: decklists.length, decks: decklists }, null, 2);
}

export function printResultsJson(keyword: string, decklists: PricedDecklist[]): void {
  console.log(formatResultsJson(keyword, decklists));
}

export function exportCsv(keyword: string, decklists: PricedDecklist[], filepath: string): void {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

  const rows: string[] = [
    ['Series', 'Theme', 'Color', 'Type', 'Qty', 'Card', 'Unit Price', 'Line Total', 'Deck Total', 'Power Level']
      .map(esc).join(','),
  ];

  for (const deck of decklists) {
    for (const card of deck.cards) {
      rows.push([
        keyword,
        deck.theme,
        deck.color,
        card.type,
        card.qty,
        card.title,
        card.unitPrice !== null ? card.unitPrice.toFixed(2) : '',
        card.lineTotal !== null ? card.lineTotal.toFixed(2) : '',
        deck.deckTotal.toFixed(2),
        deck.powerLevel,
      ].map(esc).join(','));
    }
  }

  writeFileSync(filepath, rows.join('\n'), 'utf8');
  console.error(`Exported ${decklists.length} decks to ${filepath}`);
}

export function exportXlsx(keyword: string, decklists: PricedDecklist[], filepath: string): void {
  const fmt = (n: number | null) => n !== null ? parseFloat(n.toFixed(2)) : null;

  // ── Sheet 1: Summary (one row per deck) ──────────────────────────────────────
  const ALL_TYPES = ['Creatures', 'Instants', 'Sorceries', 'Enchantments', 'Artifacts', 'Lands'];

  const summaryHeader = ['Deck', 'Total ($)', 'Power (1-5)', 'Stars', 'Description', ...ALL_TYPES.map(t => `${t} ($)`)];
  const summaryRows = decklists.map(deck => {
    const byType: Record<string, number> = {};
    for (const card of deck.cards) {
      if (card.lineTotal === null) continue;
      // match loosely (e.g. "Creatures" matches "Creatures (7 cards)")
      const key = ALL_TYPES.find(t => card.type.startsWith(t)) ?? card.type;
      byType[key] = (byType[key] ?? 0) + card.lineTotal;
    }
    return [
      deck.theme,
      fmt(deck.deckTotal),
      deck.powerLevel,
      '★'.repeat(deck.powerLevel) + '☆'.repeat(5 - deck.powerLevel),
      deck.description,
      ...ALL_TYPES.map(t => fmt(byType[t] ?? null)),
    ];
  });

  const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
  summarySheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: summaryHeader.length - 1 })}` };

  // ── Sheet 2: Cards (one row per card) ─────────────────────────────────────────
  const cardsHeader = ['Series', 'Deck', 'Type', 'Card', 'Qty', 'Unit ($)', 'Line Total ($)', 'Deck Total ($)', 'Power (1-5)'];
  const cardsRows: (string | number | null)[][] = decklists.flatMap(deck =>
    deck.cards.map(card => [
      keyword,
      deck.theme,
      card.type,
      card.title,
      card.qty,
      fmt(card.unitPrice),
      fmt(card.lineTotal),
      fmt(deck.deckTotal),
      deck.powerLevel,
    ]),
  );

  const cardsSheet = XLSX.utils.aoa_to_sheet([cardsHeader, ...cardsRows]);
  cardsSheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: cardsHeader.length - 1 })}` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, cardsSheet, 'Cards');
  XLSX.writeFile(wb, filepath);
  console.error(`Exported ${decklists.length} decks to ${filepath}`);
}
