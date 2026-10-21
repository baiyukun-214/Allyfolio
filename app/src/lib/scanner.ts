import { chromium, type Browser, type Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { config } from '../config.ts';
import { assertPublicHost, parsePublicUrl, UnsafeUrlError } from './ssrf.ts';

export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';
export const IMPACTS: Impact[] = ['critical', 'serious', 'moderate', 'minor'];
export interface Issue { pageUrl: string; ruleId: string; impact: Impact; wcag: string[]; help: string; helpUrl: string; target: string; html: string; fingerprint: string }
export interface PageResult { url: string; finalUrl: string; status: number | null; issues: Issue[]; links: string[]; error?: string }

/** axe tags like "wcag111" → "1.1.1", "wcag2aa" → level. */
export function wcagRefs(tags: string[]): string[] {
  const sc = tags.filter((t) => /^wcag\d{3,4}$/.test(t)).map((t) => { const d = t.slice(4); return d.length === 3 ? d.split('').join('.') : `${d[0]}.${d[1]}.${d.slice(2)}`; });
  const lvl = tags.find((t) => /^wcag2(1|2)?a{1,3}$/.test(t));
  const level = lvl ? lvl.replace(/^wcag2(1|2)?/, '').toUpperCase() : '';
  return sc.map((s) => (level ? `WCAG ${s} (${level})` : `WCAG ${s}`));
}
export const fingerprint = (pageUrl: string, ruleId: string, target: string) => createHash('sha256').update(`${new URL(pageUrl).pathname}|${ruleId}|${target}`).digest('hex').slice(0, 24);

let browserP: Promise<Browser> | undefined;
export function browser() { return (browserP ??= chromium.launch({ args: ['--disable-dev-shm-usage'] })); }
export async function closeBrowser() { if (browserP) { const b = await browserP; browserP = undefined; await b.close(); } }

// Simple semaphore to cap concurrent browser pages.
let active = 0; const waiters: (() => void)[] = [];
async function acquire() { if (active < config.scanConcurrency) { active++; return; } await new Promise<void>((r) => waiters.push(r)); active++; }
function release() { active--; waiters.shift()?.(); }

/** Every request the page makes (incl. each redirect hop, subresource, iframe) is re-checked against the SSRF guard. */
async function guardPage(page: Page) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    let u: URL;
    try { u = new URL(req.url()); } catch { return route.abort('blockedbyclient'); }
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.abort('blockedbyclient');
    try { await assertPublicHost(u.hostname); } catch { return route.abort('blockedbyclient'); }
    if (!['document', 'stylesheet', 'script', 'font', 'image', 'xhr', 'fetch'].includes(req.resourceType())) return route.abort('blockedbyclient');
    try {
      // Fetch from Node with redirects disabled so the browser re-requests each hop and it gets re-checked here.
      const resp = await route.fetch({ maxRedirects: 0, timeout: 15000 });
      return route.fulfill({ response: resp });
    } catch { return route.abort('failed'); }
  });
}

export async function scanPage(rawUrl: string, opts: { collectLinks?: boolean } = {}): Promise<PageResult> {
  const url = parsePublicUrl(rawUrl);
  await assertPublicHost(url.hostname);
  await acquire();
  const b = await browser();
  const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 AllyfolioBot/0.1 (+https://allyfolio.com/bot)', viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true });
  const page = await ctx.newPage();
  const deadline = setTimeout(() => ctx.close().catch(() => {}), config.scanTimeoutMs + 5000);
  try {
    await guardPage(page);
    const res = await page.goto(url.href, { waitUntil: 'load', timeout: config.scanTimeoutMs });
    if (!res) throw new Error('No response from the page.');
    const finalUrl = page.url();
    parsePublicUrl(finalUrl); // final URL after redirects must still be acceptable
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const issues: Issue[] = [];
    for (const v of r.violations) for (const n of v.nodes) {
      const target = n.target.map(String).join(' ');
      issues.push({ pageUrl: finalUrl, ruleId: v.id, impact: (v.impact ?? 'minor') as Impact, wcag: wcagRefs(v.tags), help: v.help, helpUrl: v.helpUrl, target, html: (n.html ?? '').slice(0, 500), fingerprint: fingerprint(finalUrl, v.id, target) });
    }
    let links: string[] = [];
    if (opts.collectLinks) links = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href)).catch(() => []);
    return { url: url.href, finalUrl, status: res.status(), issues, links };
  } catch (e: any) {
    if (e instanceof UnsafeUrlError) throw e;
    const msg = /Timeout/i.test(e?.message ?? '') ? 'The page took too long to load.' : /ERR_BLOCKED_BY_CLIENT/.test(e?.message ?? '') ? 'That address is not publicly reachable.' : 'We could not load that page.';
    return { url: url.href, finalUrl: url.href, status: null, issues: [], links: [], error: msg };
  } finally { clearTimeout(deadline); await ctx.close().catch(() => {}); release(); }
}

export function summarize(issues: Issue[]) {
  const counts: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const rules = new Map<string, { ruleId: string; impact: Impact; help: string; helpUrl: string; wcag: string[]; count: number; examples: string[] }>();
  for (const i of issues) {
    counts[i.impact]++;
    const r = rules.get(i.ruleId) ?? { ruleId: i.ruleId, impact: i.impact, help: i.help, helpUrl: i.helpUrl, wcag: i.wcag, count: 0, examples: [] };
    r.count++; if (r.examples.length < 3) r.examples.push(i.target); rules.set(i.ruleId, r);
  }
  const byImpact = IMPACTS.map((impact) => ({ impact, count: counts[impact], rules: [...rules.values()].filter((r) => r.impact === impact).sort((a, b) => b.count - a.count) }));
  return { total: issues.length, counts, byImpact };
}
export const AUTOMATION_NOTE = 'Automated testing finds roughly 57% of accessibility issues (Deque study). A clean result does not mean the page is fully accessible – manual review by people is still needed.';
