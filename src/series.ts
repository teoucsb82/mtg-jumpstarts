// Fixed, closed list of MTG Jumpstart-format products. The MCP server only
// serves data for series in this list — anything else (e.g. "Bloomburrow",
// "Spider-Man") is rejected with a clear error rather than scraped on demand.
// "Jumpstart: Historic Horizons" is deliberately excluded — Arena-only
// digital release, no paper Scryfall prices to attach.

export const SERIES_NAMES = [
  'Jumpstart',
  'Jumpstart 2022',
  'Lord of the Rings: Tales of Middle-earth Jumpstart',
  'Foundations Jumpstart',
  'Avatar: The Last Airbender',
  'Marvel Super Heroes',
] as const;

export type SeriesName = typeof SERIES_NAMES[number];

export const SERIES_SLUGS: Record<SeriesName, string> = {
  'Jumpstart': 'jumpstart-2020',
  'Jumpstart 2022': 'jumpstart-2022',
  'Lord of the Rings: Tales of Middle-earth Jumpstart': 'lotr',
  'Foundations Jumpstart': 'foundations',
  'Avatar: The Last Airbender': 'avatar',
  'Marvel Super Heroes': 'marvel',
};

function isSeriesName(name: string): name is SeriesName {
  return (SERIES_NAMES as readonly string[]).includes(name);
}

export function resolveSeriesSlug(name: string): string {
  if (!isSeriesName(name)) {
    throw new Error(`Unknown series "${name}". Valid series: ${SERIES_NAMES.join(', ')}`);
  }
  return SERIES_SLUGS[name];
}

// A small number of series don't map cleanly from display name to mtg.wiki
// page title via buildSeriesUrl's generic guess. Verified overrides for
// those (checked directly against mtg.wiki, not guessed):
//  - "Jumpstart" alone guesses /page/Jumpstart, which is a short overview
//    stub with no theme/decklist links — the real page is Jumpstart_(2020).
export const SERIES_WIKI_URL_OVERRIDES: Partial<Record<SeriesName, string>> = {
  'Jumpstart': 'https://mtg.wiki/page/Jumpstart_(2020)',
};
