// Pure text formatter for a printable double-sided Jumpstart deck insert card
// (2"x3.5"). No network/file/Claude API calls — layout only. Pairing reasoning
// happens upstream, in the calling Claude via the jumpstart-deck-strategy skill.

import { CATEGORY_ORDER } from './types.js';

export type DeckInsertCardInput = {
  series?: string;
  theme: string;
  color: string;
  description: string;
  powerLevel: number;
  cards: { title: string; type: string; qty: number }[];
  pairings: { theme: string; color: string; reason: string }[];
};

function groupByCategory(cards: DeckInsertCardInput['cards']): { name: string; cards: DeckInsertCardInput['cards'] }[] {
  const byCategory = new Map<string, DeckInsertCardInput['cards']>();
  for (const card of cards) {
    const key = CATEGORY_ORDER.find(t => card.type.startsWith(t)) ?? card.type;
    const group = byCategory.get(key);
    if (group) group.push(card);
    else byCategory.set(key, [card]);
  }

  const ordered = CATEGORY_ORDER.filter(name => byCategory.has(name));
  const extras = [...byCategory.keys()].filter(name => !(CATEGORY_ORDER as readonly string[]).includes(name));
  return [...ordered, ...extras].map(name => ({ name, cards: byCategory.get(name)! }));
}

export function formatDeckInsertCard(input: DeckInsertCardInput): string {
  const { series, theme, color, description, powerLevel, cards, pairings } = input;

  const powerCircles = '●'.repeat(powerLevel) + '○'.repeat(5 - powerLevel);
  const cardCount = cards.reduce((sum, c) => sum + c.qty, 0);
  const capitalizedColor = color.charAt(0).toUpperCase() + color.slice(1);

  const frontLines = [
    '=== FRONT ===',
    ...(series ? [series] : []),
    `${theme} (${capitalizedColor})`,
    `Power Level: ${powerCircles}`,
    '',
    description,
    '',
    'Suggested Pairings:',
    ...pairings.map(p => `  ${p.theme} (${p.color}) - ${p.reason}`),
  ];

  const categories = groupByCategory(cards);
  const backLines = [
    '=== BACK ===',
    `${theme} — Deck List (${cardCount} cards)`,
    '',
    ...categories.flatMap(({ name, cards: categoryCards }) => [
      `${name} (${categoryCards.reduce((sum, c) => sum + c.qty, 0)})`,
      ...categoryCards.map(c => `  ${c.qty}x ${c.title}`),
    ]),
  ];

  return [...frontLines, '', ...backLines].join('\n');
}
