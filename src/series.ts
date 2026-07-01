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
  'Dominaria United Jumpstart',
  'The Brothers\' War Jumpstart',
  'Phyrexia: All Will Be One Jumpstart',
  'March of the Machine Jumpstart',
] as const;

export type SeriesName = typeof SERIES_NAMES[number];

export const SERIES_SLUGS: Record<SeriesName, string> = {
  'Jumpstart': 'jumpstart-2020',
  'Jumpstart 2022': 'jumpstart-2022',
  'Lord of the Rings: Tales of Middle-earth Jumpstart': 'lotr',
  'Foundations Jumpstart': 'foundations',
  'Avatar: The Last Airbender': 'avatar',
  'Marvel Super Heroes': 'marvel',
  'Dominaria United Jumpstart': 'dominaria-united',
  'The Brothers\' War Jumpstart': 'brothers-war',
  'Phyrexia: All Will Be One Jumpstart': 'phyrexia-one',
  'March of the Machine Jumpstart': 'march-of-the-machine',
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
//  - LOTR Jumpstart doesn't follow the "<Name>_Jumpstart" pattern at all —
//    it's a subpage, "The_Lord_of_the_Rings:_Tales_of_Middle-earth/Jumpstart".
//    The MediaWiki search fallback also picks the wrong top result for it
//    ("Holiday_Release" outranks "Jumpstart"), so this bypasses both guesses.
//  - Dominaria United / The Brothers' War / Phyrexia: All Will Be One /
//    March of the Machine were each released with a small bundled Jumpstart
//    booster (5 themes x 2 color variants = 10 decks) rather than a
//    standalone product. Same "<Set>/Jumpstart" subpage pattern as LOTR, not
//    "<Set>_Jumpstart", so they need the same kind of override.
export const SERIES_WIKI_URL_OVERRIDES: Partial<Record<SeriesName, string>> = {
  'Jumpstart': 'https://mtg.wiki/page/Jumpstart_(2020)',
  'Lord of the Rings: Tales of Middle-earth Jumpstart':
    'https://mtg.wiki/page/The_Lord_of_the_Rings:_Tales_of_Middle-earth/Jumpstart',
  'Dominaria United Jumpstart': 'https://mtg.wiki/page/Dominaria_United/Jumpstart',
  'The Brothers\' War Jumpstart': 'https://mtg.wiki/page/The_Brothers\'_War/Jumpstart',
  'Phyrexia: All Will Be One Jumpstart':
    'https://mtg.wiki/page/Phyrexia:_All_Will_Be_One/Jumpstart',
  'March of the Machine Jumpstart': 'https://mtg.wiki/page/March_of_the_Machine/Jumpstart',
};
