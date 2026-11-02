import { gunzipSync } from 'node:zlib';
import { safeFetch } from './ssrf.ts';

/** Why a discovered URL was not scanned. Counted per distinct URL. */
export type SkipReason = 'other_host' | 'file' | 'robots' | 'query' | 'limit' | 'duplicate' | 'redirect_away' | 'error';
export const SKIP_REASONS: SkipReason[] = ['other_host', 'file', 'robots', 'query', 'limit', 'duplicate', 'redirect_away', 'error'];
const FILE_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|zip|rar|7z|gz|tgz|mp4|mp3|m4a|wav|ogg|mov|avi|webm|docx?|xlsx?|pptx?|odt|ods|csv|css|js|mjs|json|xml|rss|atom|txt|md|woff2?|ttf|eot|exe|dmg|apk|ics|vcf)$/i;
const MAX_QUERY = 200;

/** The scanned site: apex and www variants of the origin's host count as the same site (both protocols). */
export interface SiteScope { origin: string; protocol: string; hosts: Set<string> }
export function siteScope(origin: string): SiteScope {
  const u = new URL(origin);
  const h = u.hostname.toLowerCase(), alt = h.startsWith('www.') ? h.slice(4) : `www.${h}`;
  const hosts = new Set([h]); if (!/^[\d.]+$/.test(h) && h.includes('.') && !h.startsWith('[')) hosts.add(alt);
  return { origin: u.origin, protocol: u.protocol, hosts };
}
const sameSite = (u: URL, s: SiteScope) => s.hosts.has(u.hostname.toLowerCase()) && (u.port === new URL(s.origin).port);

/** Key used to tell pages apart: host without www, path without trailing slash, query. Protocol and fragment are ignored. */
export function pageKey(href: string): string {
  const u = new URL(href);
  let p = u.pathname.replace(/\/index\.(html?|php)$/i, '/'); if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1);
  return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.port ? ':' + u.port : ''}${p}${u.search}`;
}

export type LinkResult = { url: string } | { skip: SkipReason; url: string } | null;
/** Classify a link found on a page or in a sitemap. null = not a page link at all (mailto:, tel:, javascript:, #…). */
export function classifyLink(href: string, base: string, scope: SiteScope): LinkResult {
  let u: URL; try { u = new URL(href, base); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  if (u.username || u.password) return null;
  if (!sameSite(u, scope)) return { skip: 'other_host', url: u.href };
  if (FILE_EXT.test(u.pathname)) return { skip: 'file', url: u.href };
  if (u.search.length > MAX_QUERY) return { skip: 'query', url: u.href };
  // Same page over http on an https site: use the site's protocol.
  if (u.protocol !== scope.protocol) u.protocol = scope.protocol;
  return { url: u.href };
}
/** Back-compat helper: crawlable same-site URL or null. */
export function normaliseLink(href: string, origin: string): string | null {
  const r = classifyLink(href, origin, siteScope(origin));
  return r && !('skip' in r) ? r.url : null;
}

// ---------- robots.txt ----------
export interface Robots { rules: { allow: boolean; path: string }[]; sitemaps: string[] }
/** Parse robots.txt for our bot: the most specific matching group ("allyfoliobot") wins over "*". */
export function parseRobots(txt: string, agent = 'allyfoliobot'): Robots {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  const sitemaps: string[] = [];
  let cur: (typeof groups)[number] | null = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'sitemap') { if (v) sitemaps.push(v); continue; }
    if (k === 'user-agent') { if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === 'allow' || k === 'disallow') { if (v || k === 'allow') cur.rules.push({ allow: k === 'allow', path: v }); }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a.replace(/\/.*$/, ''))));
  const pick = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return { rules: pick.flatMap((g) => g.rules).filter((r) => r.path), sitemaps };
}
const ruleRe = (p: string) => {
  const end = p.endsWith('$'), body = (end ? p.slice(0, -1) : p).split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (end ? '$' : ''));
};
/** Longest matching rule wins; on a tie Allow wins (RFC 9309). */
export function robotsAllows(r: Robots, href: string): boolean {
  const u = new URL(href); const path = u.pathname + u.search;
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of r.rules) {
    if (!ruleRe(rule.path).test(path)) continue;
    const len = rule.path.length;
    if (!best || len > best.len || (len === best.len && rule.allow)) best = { allow: rule.allow, len };
  }
  return best ? best.allow : true;
}
async function fetchText(url: string, max = 5_000_000): Promise<string | null> {
  try {
    const r = await safeFetch(url, { timeoutMs: 10000 });
    if (!r.ok) { await r.body?.cancel().catch(() => {}); return null; }
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf, { maxOutputLength: 50_000_000 });
    return buf.subarray(0, max).toString('utf8');
  } catch { return null; }
}
export async function loadRobots(origin: string): Promise<Robots | null> {
  const txt = await fetchText(new URL('/robots.txt', origin).href, 500_000);
  return txt == null || /<html/i.test(txt.slice(0, 500)) ? null : parseRobots(txt);
}

// ---------- sitemaps ----------
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const dec = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  if (/<sitemapindex/i.test(xml)) return { pages: [], sitemaps: [...xml.matchAll(/<sitemap\b[^>]*>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)].map((m) => dec(m[1])) };
  return { pages: [...xml.matchAll(/<url\b[^>]*>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)].map((m) => dec(m[1])), sitemaps: [] };
}
export interface Discovery { pages: string[]; sitemapFiles: string[]; sitemapUrls: number; robots: Robots | null; skipped: { reason: SkipReason; url: string }[] }
const MAX_SITEMAP_FILES = 50;
/** Sitemaps from robots.txt "Sitemap:" lines (same site only), /sitemap.xml and /sitemap_index.xml; nested indexes up to 3 levels, gzip supported. */
export async function discover(origin: string, cap: number, robots?: Robots | null): Promise<Discovery> {
  const scope = siteScope(origin);
  if (robots === undefined) robots = await loadRobots(origin);
  const out = new Map<string, string>(); const skipped: Discovery['skipped'] = []; const files: string[] = []; const tried = new Set<string>();
  let total = 0;
  const load = async (url: string, depth: number) => {
    if (out.size >= cap || depth > 3 || files.length >= MAX_SITEMAP_FILES || tried.has(url)) return;
    tried.add(url);
    const xml = await fetchText(url); if (xml == null || !/<(urlset|sitemapindex)\b/i.test(xml)) return;
    files.push(url);
    const { pages, sitemaps } = parseSitemap(xml);
    for (const p of pages) {
      total++;
      const r = classifyLink(p, origin, scope); if (!r) continue;
      if ('skip' in r) { skipped.push({ reason: r.skip, url: r.url }); continue; }
      if (robots && !robotsAllows(robots, r.url) && pageKey(r.url) !== pageKey(origin)) { skipped.push({ reason: 'robots', url: r.url }); continue; }
      const k = pageKey(r.url); if (!out.has(k)) out.set(k, r.url);
      if (out.size >= cap) return;
    }
    for (const s of sitemaps) { let su: URL; try { su = new URL(s, url); } catch { continue; } if (sameSite(su, scope)) await load(su.href, depth + 1); }
  };
  const candidates = [...(robots?.sitemaps ?? []).filter((s) => { try { return sameSite(new URL(s), scope); } catch { return false; } }), new URL('/sitemap.xml', origin).href, new URL('/sitemap_index.xml', origin).href];
  for (const c of candidates) { if (out.size >= cap) break; if (files.length && c.endsWith('/sitemap_index.xml')) break; await load(c, 0); }
  return { pages: [...out.values()].slice(0, cap), sitemapFiles: files, sitemapUrls: total, robots, skipped };
}
/** Sitemap URLs first (same site), up to cap. */
export async function sitemapUrls(origin: string, cap: number): Promise<string[]> { return (await discover(origin, cap)).pages; }
