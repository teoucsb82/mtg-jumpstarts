// Pure text formatter for a printable double-sided Jumpstart deck insert card
// (2"x3.5", portrait). No network/file/Claude API calls — layout only. Pairing
// reasoning happens upstream, in the calling Claude via the jumpstart-deck-strategy
// skill; leader-card selection is deterministic (highest rarity present) so it's
// handled here instead.
//
// Back-of-card lines are plain inline text ("title (Rarity, Colors)"), not a
// column-aligned table — portrait's ~19-23 usable characters at a readable font
// size can't hold a right-justified table without wrapping nearly every card,
// which grows the back face past what portrait's height can fit. See the design
// doc for the print-sizing math.

import { CATEGORY_ORDER } from './types.js';

export type DeckInsertCardCard = { title: string; type: string; qty: number; rarity: string | null; colors: string[] };

export type DeckInsertCardInput = {
  series?: string;
  theme: string;
  color: string;
  playstyle: string[];
  tips: string[];
  powerLevel: number;
  cards: DeckInsertCardCard[];
  pairings: { theme: string; color: string; reason: string }[];
};

const RARITY_RANK: Record<string, number> = { mythic: 4, rare: 3, special: 3, bonus: 3, uncommon: 2, common: 1 };

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function colorLabel(color: string): string {
  return color.toLowerCase() === 'multi' ? 'Multicolor' : capitalize(color);
}

function colorTag(colors: string[]): string {
  return colors.length === 0 ? 'C' : colors.join('/');
}

function selectLeaders(cards: DeckInsertCardCard[]): { names: string[]; rarity: string } | null {
  const candidates = cards.filter(c => (c.rarity ? RARITY_RANK[c.rarity.toLowerCase()] ?? 0 : 0) >= 2);
  if (candidates.length === 0) return null;

  const maxRank = Math.max(...candidates.map(c => RARITY_RANK[c.rarity!.toLowerCase()]));
  const top = candidates.filter(c => RARITY_RANK[c.rarity!.toLowerCase()] === maxRank);
  return { names: [...new Set(top.map(c => c.title))], rarity: capitalize(top[0].rarity!.toLowerCase()) };
}

function groupByCategory(cards: DeckInsertCardCard[]): { name: string; cards: DeckInsertCardCard[] }[] {
  const byCategory = new Map<string, DeckInsertCardCard[]>();
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

export function formatDeckInsertCard(input: DeckInsertCardInput): { front: string; back: string } {
  const { series, theme, color, playstyle, tips, powerLevel, cards, pairings } = input;

  const powerCircles = '●'.repeat(powerLevel) + '○'.repeat(5 - powerLevel);
  const leaders = selectLeaders(cards);

  const front = [
    ...(series ? [series] : []),
    theme,
    `Color: ${colorLabel(color)}`,
    `Power Level: ${powerCircles}`,
    ...(leaders ? [`${leaders.names.length > 1 ? 'Leaders' : 'Leader'}: ${leaders.names.join(', ')} (${leaders.rarity})`] : []),
    '',
    `Playstyle: ${playstyle.join(', ')}`,
    '',
    'Tips:',
    ...tips.map(t => `  - ${t}`),
    '',
    'Synergies:',
    ...pairings.map(p => `  ${p.theme} (${colorLabel(p.color)}) - ${p.reason}`),
  ].join('\n');

  const categories = groupByCategory(cards);
  const back = [
    theme,
    '',
    ...categories.flatMap(({ name, cards: categoryCards }) => [
      `${name} (${categoryCards.reduce((sum, c) => sum + c.qty, 0)})`,
      ...categoryCards.map(c => {
        const qtyPrefix = c.qty > 1 ? `${c.qty}x ` : '';
        const rarity = c.rarity ? capitalize(c.rarity.toLowerCase()) : 'Unknown';
        return `  ${qtyPrefix}${c.title} (${rarity}, ${colorTag(c.colors)})`;
      }),
    ]),
  ].join('\n');

  return { front, back };
}
