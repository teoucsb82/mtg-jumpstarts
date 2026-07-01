// Scryfall API: fetch USD price, rarity, colors, and oracle text for a list of
// card names. Uses the /cards/collection bulk endpoint (max 75 cards per
// request), which already returns rarity/colors/oracle_text alongside price on
// the same card object -- no extra requests needed to get them.
// Up to 4 requests run in parallel; a short delay between batches avoids
// hitting Scryfall's 10 req/sec rate limit.

const BATCH_SIZE = 75;
const MAX_CONCURRENT = 4;

export type ScryfallCardData = {
  price: number | null;
  rarity: string | null;
  colors: string[];
  text: string | null;
};

export async function fetchScryfallCardData(
  cardNames: string[],
): Promise<Map<string, ScryfallCardData>> {
  const cardDataMap = new Map<string, ScryfallCardData>();

  const batches: string[][] = [];
  for (let i = 0; i < cardNames.length; i += BATCH_SIZE) {
    batches.push(cardNames.slice(i, i + BATCH_SIZE));
  }

  const unknown: ScryfallCardData = { price: null, rarity: null, colors: [], text: null };

  const fetchBatch = async (batch: string[]) => {
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'mtg-jumpstarts-cli/1.0',
      },
      body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
    });

    if (!res.ok) {
      console.error(`Scryfall batch failed: HTTP ${res.status}`);
      batch.forEach(name => cardDataMap.set(name, unknown));
      return;
    }

    const data = await res.json() as {
      data: Array<{
        name: string;
        prices: { usd: string | null };
        rarity?: string;
        colors?: string[];
        oracle_text?: string;
        card_faces?: Array<{ oracle_text?: string }>;
      }>;
    };

    for (const card of data.data) {
      const usd = card.prices?.usd;
      const text = card.oracle_text
        ?? (card.card_faces?.map(f => f.oracle_text).filter(Boolean).join(' // ') || null);
      cardDataMap.set(card.name, {
        price: usd != null ? parseFloat(usd) : null,
        rarity: card.rarity ?? null,
        colors: card.colors ?? [],
        text: text || null,
      });
    }
    // Mark any cards not returned by Scryfall as unknown
    for (const name of batch) {
      if (!cardDataMap.has(name)) cardDataMap.set(name, unknown);
    }
  };

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    await Promise.all(batches.slice(i, i + MAX_CONCURRENT).map(fetchBatch));
  }

  return cardDataMap;
}
