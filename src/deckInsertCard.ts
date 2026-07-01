// Pure text formatter for a printable double-sided Jumpstart deck insert card
// (3.5"x2", landscape). No network/file/Claude API calls — layout only. Pairing
// reasoning happens upstream, in the calling Claude via the jumpstart-deck-strategy
// skill; leader-card selection is deterministic (highest rarity present) so it's
// handled here instead.
//
// Both faces target a fixed 46-column x 13-row grid (Roboto Mono 8pt hardcoded).
// Back face lists nonland cards only, one per line, right-justified rarity/color
// tag — verified against every real baked deck to always fit within 13 rows. See
// the design doc for the full line-budget math.

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

const WIDTH = 46;
const HEIGHT = 13;
const SYNERGY_MIN_RESERVE = 2;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function colorLabel(color: string): string {
  return color.toLowerCase() === 'multi' ? 'Multicolor' : capitalize(color);
}

function colorTag(colors: string[]): string {
  return colors.length === 0 ? 'C' : colors.join('/');
}

function rarityLetter(rarity: string | null): string | null {
  if (!rarity) return null;
  switch (rarity.toLowerCase()) {
    case 'common': return 'C';
    case 'uncommon': return 'U';
    case 'rare': case 'special': case 'bonus': return 'R';
    case 'mythic': return 'M';
    default: return null;
  }
}

function wrapText(text: string, width: number = WIDTH): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function formatCardLine(card: DeckInsertCardCard): string {
  const qtyPrefix = card.qty > 1 ? `${card.qty}x ` : '';
  const title = `${qtyPrefix}${card.title}`;
  const letter = rarityLetter(card.rarity);
  if (letter === null) return title;
  const tag = `(${letter}, ${colorTag(card.colors)})`;
  if (title.length + 1 + tag.length > WIDTH) return title;
  return title + ' '.repeat(WIDTH - title.length - tag.length) + tag;
}

function selectLeaders(cards: DeckInsertCardCard[]): { names: string[]; rarity: string } | null {
  const candidates = cards.filter(c => (c.rarity ? RARITY_RANK[c.rarity.toLowerCase()] ?? 0 : 0) >= 2);
  if (candidates.length === 0) return null;

  const maxRank = Math.max(...candidates.map(c => RARITY_RANK[c.rarity!.toLowerCase()]));
  const top = candidates.filter(c => RARITY_RANK[c.rarity!.toLowerCase()] === maxRank);
  return { names: [...new Set(top.map(c => c.title))], rarity: top[0].rarity!.toLowerCase() };
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

  const frontLines: string[] = [];

  frontLines.push(...wrapText(`**${theme}**${series ? ` — ${series}` : ''} (${colorLabel(color)}) ${powerCircles}`));

  if (leaders) {
    const letter = rarityLetter(leaders.rarity);
    const label = leaders.names.length > 1 ? 'Leaders' : 'Leader';
    const tag = letter ? ` (${letter})` : '';
    frontLines.push(...wrapText(`${label}: ${leaders.names.join(', ')}${tag}`));
  }

  frontLines.push(...wrapText(`**Playstyle:** ${playstyle.join(', ')}`));

  const tipsCap = Math.max(0, HEIGHT - frontLines.length - SYNERGY_MIN_RESERVE);
  const tipLines: string[] = [];
  for (let i = 0; i < tips.length; i++) {
    const prefix = i === 0 ? '**Tips:** ' : '- ';
    const candidate = wrapText(`${prefix}${tips[i]}`);
    if (tipLines.length + candidate.length > tipsCap) break;
    tipLines.push(...candidate);
  }
  frontLines.push(...tipLines);

  const synergyBudget = Math.max(0, HEIGHT - frontLines.length);
  const synergyLines: string[] = [];
  for (let i = 0; i < pairings.length; i++) {
    const p = pairings[i];
    const prefix = i === 0 ? '**Synergies:** ' : '- ';
    const candidate = wrapText(`${prefix}${p.theme}(${colorLabel(p.color).charAt(0)}): ${p.reason}`);
    if (synergyLines.length + candidate.length > synergyBudget) break;
    synergyLines.push(...candidate);
  }
  frontLines.push(...synergyLines);

  const front = frontLines.join('\n');

  const nonland = groupByCategory(cards.filter(c => !c.type.startsWith('Lands'))).flatMap(g => g.cards);
  const back = nonland.map(formatCardLine).join('\n');

  return { front, back };
}
