export type Theme = { name: string; url: string };
export type Card = { qty: number; name: string };
export type Category = { name: string; cards: Card[] };
export type Decklist = { theme: string; categories: Category[] };

export type PricedCard = Card & { unitPrice: number | null };
export type PricedCategory = { name: string; cards: PricedCard[]; categoryTotal: number };
export type PricedDecklist = {
  theme: string;
  categories: PricedCategory[];
  deckTotal: number;
  powerTier: 'Budget' | 'Mid' | 'Premium';
};
