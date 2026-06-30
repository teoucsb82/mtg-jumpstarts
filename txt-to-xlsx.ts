// Converts generated .txt files to .xlsx without re-running the scraper.
// Usage: npx tsx txt-to-xlsx.ts generated/marvel.txt [generated/avatar.txt ...]
//        (output goes alongside each input file: generated/marvel.xlsx)

import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

interface ParsedCard {
  name: string;
  qty: number;
  unitPrice: number | null;
  lineTotal: number | null;
}

interface ParsedCategory {
  name: string;
  cards: ParsedCard[];
  categoryTotal: number;
}

interface ParsedDeck {
  theme: string;
  series: string;
  categories: ParsedCategory[];
  deckTotal: number;
  powerTier: number;
}

function parseTxt(filepath: string): { series: string; decks: ParsedDeck[] } {
  const text = readFileSync(filepath, 'utf8');
  const lines = text.split('\n');

  let series = '';
  const decks: ParsedDeck[] = [];
  let currentDeck: ParsedDeck | null = null;
  let currentCat: ParsedCategory | null = null;

  for (const line of lines) {
    // === MARVEL SUPER HEROES JUMPSTART ===
    const seriesMatch = line.match(/^===\s+(.+?)\s+===$/);
    if (seriesMatch) { series = seriesMatch[1]; continue; }

    // --- Deck Name ---
    const deckMatch = line.match(/^---\s+(.+?)\s+---/);
    if (deckMatch) {
      if (currentCat && currentDeck) currentDeck.categories.push(currentCat);
      currentCat = null;
      currentDeck = { theme: deckMatch[1], series, categories: [], deckTotal: 0, powerTier: 0 };
      decks.push(currentDeck);
      continue;
    }

    if (!currentDeck) continue;

    // [20 cards total | Deck value: $3.32 | Power: ★★☆☆☆ (2/5)]
    const summaryMatch = line.match(/Deck value:\s*\$([0-9.]+).*\((\d)\/5\)/);
    if (summaryMatch) {
      currentDeck.deckTotal = parseFloat(summaryMatch[1]);
      currentDeck.powerTier = parseInt(summaryMatch[2], 10);
      if (currentCat) { currentDeck.categories.push(currentCat); currentCat = null; }
      continue;
    }

    // Creatures (7 cards)  $2.15
    const catMatch = line.match(/^([A-Za-z]+)\s+\(\d+ cards?\)(?:\s+\$([0-9.]+))?$/);
    if (catMatch) {
      if (currentCat) currentDeck.categories.push(currentCat);
      currentCat = { name: catMatch[1], cards: [], categoryTotal: catMatch[2] ? parseFloat(catMatch[2]) : 0 };
      continue;
    }

    // "  1x Card Name  $0.24 ea  $0.24"  or  "  1x Card Name  (price unknown)"
    const cardMatch = line.match(/^\s+(\d+)x\s+(.+?)(?:\s+\$([0-9.]+)\s+ea\s+\$([0-9.]+)|\s+\(price unknown\))?$/);
    if (cardMatch && currentCat) {
      currentCat.cards.push({
        qty: parseInt(cardMatch[1], 10),
        name: cardMatch[2].trim(),
        unitPrice: cardMatch[3] ? parseFloat(cardMatch[3]) : null,
        lineTotal: cardMatch[4] ? parseFloat(cardMatch[4]) : null,
      });
    }
  }

  return { series, decks };
}

function buildXlsx(series: string, decks: ParsedDeck[], outPath: string): void {
  const ALL_TYPES = ['Creatures', 'Instants', 'Sorceries', 'Enchantments', 'Artifacts', 'Lands'];

  // ── Summary sheet ────────────────────────────────────────────────────────────
  const summaryHeader = ['Deck', 'Total ($)', 'Power (1-5)', 'Stars', ...ALL_TYPES.map(t => `${t} ($)`)];
  const summaryRows = decks.map(deck => {
    const byType: Record<string, number> = {};
    for (const cat of deck.categories) {
      const key = ALL_TYPES.find(t => cat.name.startsWith(t)) ?? cat.name;
      byType[key] = (byType[key] ?? 0) + cat.categoryTotal;
    }
    return [
      deck.theme,
      deck.deckTotal,
      deck.powerTier,
      '★'.repeat(deck.powerTier) + '☆'.repeat(5 - deck.powerTier),
      ...ALL_TYPES.map(t => byType[t] ?? null),
    ];
  });

  const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
  summarySheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: summaryHeader.length - 1 })}` };

  // ── Cards sheet ──────────────────────────────────────────────────────────────
  const cardsHeader = ['Series', 'Deck', 'Type', 'Card', 'Qty', 'Unit ($)', 'Line Total ($)', 'Deck Total ($)', 'Power (1-5)'];
  const cardsRows: (string | number | null)[][] = [];
  for (const deck of decks) {
    for (const cat of deck.categories) {
      for (const card of cat.cards) {
        cardsRows.push([
          series,
          deck.theme,
          cat.name,
          card.name,
          card.qty,
          card.unitPrice,
          card.lineTotal,
          deck.deckTotal,
          deck.powerTier,
        ]);
      }
    }
  }

  const cardsSheet = XLSX.utils.aoa_to_sheet([cardsHeader, ...cardsRows]);
  cardsSheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: cardsHeader.length - 1 })}` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, cardsSheet, 'Cards');
  XLSX.writeFile(wb, outPath);
  console.log(`  ✓ ${outPath} (${decks.length} decks)`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npx tsx txt-to-xlsx.ts generated/marvel.txt [...]');
  process.exit(1);
}

for (const inPath of args) {
  const outPath = inPath.replace(/\.txt$/, '.xlsx');
  try {
    const { series, decks } = parseTxt(inPath);
    buildXlsx(series, decks, outPath);
  } catch (err) {
    console.error(`  ✗ ${inPath}: ${err}`);
  }
}
