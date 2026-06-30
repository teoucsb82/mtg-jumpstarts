// In-memory HTML cache: avoids re-fetching the same URL within a single run
// (covers retries and deduplicated URLs like the series page)
const htmlCache = new Map<string, string>();

export function buildSeriesUrl(keyword: string): string {
  const normalized = keyword
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('_');
  return `https://mtg.wiki/page/${normalized}_Jumpstart`;
}

export function stripHtml(raw: string): string {
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 60_000); // cap at ~15k tokens; boilerplate beyond this adds noise
}

export async function fetchHtml(url: string): Promise<string> {
  if (htmlCache.has(url)) return htmlCache.get(url)!;
  const res = await fetch(url, { headers: { 'User-Agent': 'mtg-jumpstarts-cli/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  htmlCache.set(url, html);
  return html;
}

export async function fetchSeriesPageWithFallback(
  keyword: string,
): Promise<{ html: string; url: string }> {
  const query = encodeURIComponent(`${keyword} Jumpstart`);
  const searchUrl = `https://mtg.wiki/api.php?action=query&list=search&srsearch=${query}&format=json`;
  const res = await fetch(searchUrl, { headers: { 'User-Agent': 'mtg-jumpstarts-cli/1.0' } });
  if (!res.ok) throw new Error(`MediaWiki search failed: HTTP ${res.status}`);
  const data = await res.json() as { query: { search: Array<{ title: string }> } };
  const results = data.query?.search;
  if (!results?.length) throw new Error(`No wiki pages found for "${keyword} Jumpstart"`);
  const title = results[0].title.replace(/ /g, '_');
  const url = `https://mtg.wiki/page/${title}`;
  return { html: await fetchHtml(url), url };
}
