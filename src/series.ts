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
