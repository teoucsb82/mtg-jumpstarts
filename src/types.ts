export type Color = 'white' | 'blue' | 'black' | 'red' | 'green' | 'multi';

const KNOWN_COLORS: Record<string, Color> = {
  white: 'white',
  blue: 'blue',
  black: 'black',
  red: 'red',
  green: 'green',
};

export function normalizeColor(raw: string): Color {
  return KNOWN_COLORS[raw.toLowerCase()] ?? 'multi';
}

// Canonical category display order, shared by xlsx export and the deck insert card
// formatter. Matched with `card.type.startsWith(t)` since baked `type` values are
// plain strings like "Creatures". Anything not in this list is appended at the end
// in first-seen order rather than dropped.
export const CATEGORY_ORDER = ['Creatures', 'Instants', 'Sorceries', 'Enchantments', 'Artifacts', 'Lands'] as const;

export type Theme = { name: string; url: string; color: string };
export type Card = { qty: number; name: string };
export type Category = { name: string; cards: Card[] };

export type Decklist = {
  theme: string;
  color?: string;
  categories: Category[];
  description: string;
};

export type PricedCard = {
  title: string;
  type: string;
  qty: number;
  unitPrice: number | null;
  lineTotal: number | null;
  rarity: string | null;
  colors: string[];
};

export type PricedDecklist = {
  theme: string;
  color: Color;
  description: string;
  cards: PricedCard[];
  cardCount: number;
  deckTotal: number;
  powerLevel: number; // 1–5, z-score relative to series
};

export type BakedCard = { title: string; type: string; qty: number };

export type BakedDecklist = {
  theme: string;
  color: Color;
  description: string;
  cards: BakedCard[];
};

export type BakedSeries = {
  series: string;
  themeCount: number;
  decks: BakedDecklist[];
};
