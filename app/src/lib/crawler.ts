import { safeFetch } from './ssrf.ts';
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|mp4|mp3|webm|docx?|xlsx?|pptx?|css|js|json|xml|txt|woff2?)$/i;
/** Normalise a link to a crawlable same-origin page URL, or null. */
export function normaliseLink(href: string, origin: string): string | null {
  let u: URL; try { u = new URL(href, origin); } catch { return null; }
  if (u.origin !== origin) return null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (SKIP_EXT.test(u.pathname)) return null;
  u.hash = '';
  if (u.search.length > 200) return null;
  if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.href;
}
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  return /<sitemapindex/i.test(xml) ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
}
/** Sitemap URLs first (follows one level of sitemap index), filtered to same origin, up to cap. */
export async function sitemapUrls(origin: string, cap: number): Promise<string[]> {
  const out = new Set<string>();
  const load = async (url: string, depth: number) => {
    if (out.size >= cap || depth > 1) return;
    let xml = '';
    try { const r = await safeFetch(url, { timeoutMs: 10000 }); if (!r.ok) return; xml = (await r.text()).slice(0, 5_000_000); } catch { return; }
    const { pages, sitemaps } = parseSitemap(xml);
    for (const p of pages) { const n = normaliseLink(p, origin); if (n) out.add(n); if (out.size >= cap) return; }
    for (const s of sitemaps.slice(0, 20)) await load(s, depth + 1);
  };
  await load(origin + '/sitemap.xml', 0);
  return [...out].slice(0, cap);
}
