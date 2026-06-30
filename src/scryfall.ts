// Scryfall API: fetch USD prices for a list of card names.
// Uses the /cards/collection bulk endpoint (max 75 cards per request).
// Up to 4 requests run in parallel; a short delay between batches avoids
// hitting Scryfall's 10 req/sec rate limit.

const BATCH_SIZE = 75;
const MAX_CONCURRENT = 4;

export async function fetchScryfallPrices(
  cardNames: string[],
): Promise<Map<string, number | null>> {
  const priceMap = new Map<string, number | null>();

  const batches: string[][] = [];
  for (let i = 0; i < cardNames.length; i += BATCH_SIZE) {
    batches.push(cardNames.slice(i, i + BATCH_SIZE));
  }

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
      batch.forEach(name => priceMap.set(name, null));
      return;
    }

    const data = await res.json() as {
      data: Array<{ name: string; prices: { usd: string | null } }>;
    };

    for (const card of data.data) {
      const usd = card.prices?.usd;
      priceMap.set(card.name, usd != null ? parseFloat(usd) : null);
    }
    // Mark any cards not returned by Scryfall as unknown
    for (const name of batch) {
      if (!priceMap.has(name)) priceMap.set(name, null);
    }
  };

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    await Promise.all(batches.slice(i, i + MAX_CONCURRENT).map(fetchBatch));
  }

  return priceMap;
}
