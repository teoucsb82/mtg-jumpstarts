export type Theme = { name: string; url: string; color: string };
export type Card = { qty: number; name: string };
export type Category = { name: string; cards: Card[] };
export type Pairing = { theme: string; reason: string };
export type Decklist = {
  theme: string;
  color?: string;
  categories: Category[];
  description: string;
  recommendedPairings?: Pairing[];
};

export type PricedCard = Card & { unitPrice: number | null };
export type PricedCategory = { name: string; cards: PricedCard[]; categoryTotal: number };
export type PricedDecklist = {
  theme: string;
  color: string;
  categories: PricedCategory[];
  deckTotal: number;
  powerTier: number; // 1–5, z-score relative to series
  description: string;
  recommendedPairings: Pairing[];
};
