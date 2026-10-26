/** Free scan helpers: SQLite-backed hourly limit (successful scans only), a short per-URL result cache, and localized presentation. */
import { createHash } from 'node:crypto';
import { all, get, run } from '../db.ts';
import { config } from '../config.ts';
import { summarize, ruleHelp, type Issue } from './scanner.ts';
import { ruleInfo, wcagLink } from './rule-info.ts';
import { automatedScore } from './insights.ts';
import { t, type Locale } from '../i18n.ts';

const HOUR = 3600_000;
const ipHash = (ip: string) => createHash('sha256').update(`allyfolio-free-scan|${ip}`).digest('hex').slice(0, 32);
const inflight = new Map<string, number>();

/** Hourly limit. Only successful scans are recorded; scans still running count too so parallel requests cannot bypass it. */
export const freeLimit = {
  check(ip: string): { ok: boolean; retryAfterS: number } {
    const h = ipHash(ip), since = Date.now() - HOUR;
    const rows = all<{ at: number }>('SELECT at FROM free_scan_hits WHERE ip_hash = ? AND at > ? ORDER BY at', h, since);
    if (rows.length + (inflight.get(h) ?? 0) < config.freeScanPerHour) return { ok: true, retryAfterS: 0 };
    const oldest = rows[0]?.at ?? Date.now();
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((oldest + HOUR - Date.now()) / 1000)) };
  },
  begin(ip: string) { const h = ipHash(ip); inflight.set(h, (inflight.get(h) ?? 0) + 1); return h; },
  end(h: string, success: boolean) {
    const n = (inflight.get(h) ?? 1) - 1; if (n > 0) inflight.set(h, n); else inflight.delete(h);
    if (success) run('INSERT INTO free_scan_hits (ip_hash, at) VALUES (?, ?)', h, Date.now());
    if (Math.random() < 0.02) run('DELETE FROM free_scan_hits WHERE at < ?', Date.now() - 2 * HOUR);
  },
  /** Test helper. */
  reset() { inflight.clear(); run('DELETE FROM free_scan_hits'); },
};

export interface Cached { id: string; url: string; scannedAt: string; at: number; issues: Issue[] }
const cache = new Map<string, Cached>();
export const cacheKey = (u: URL) => { const c = new URL(u.href); c.hash = ''; c.hostname = c.hostname.toLowerCase(); return c.href; };
export function cacheGet(key: string): Cached | undefined {
  const c = cache.get(key);
  if (!c) return;
  if (Date.now() - c.at > config.freeScanCacheMin * 60_000) { cache.delete(key); return; }
  return c;
}
export function cachePut(keys: string[], c: Cached) {
  for (const k of new Set(keys)) cache.set(k, c);
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > config.freeScanCacheMin * 60_000 || cache.size > 500) cache.delete(k);
}
export const cacheClear = () => cache.clear();

/** Average duration of recent free scans, for the ETA. */
let avgMs = 15000;
export const recordDuration = (ms: number) => { avgMs = Math.round(avgMs * 0.8 + ms * 0.2); };
export const avgScanMs = () => avgMs;
export function etaSeconds(queued: number, active: number, slots: number) {
  const ahead = Math.max(0, queued + active - slots + 1);
  return Math.ceil((avgMs * (1 + Math.ceil(ahead / Math.max(1, slots)))) / 1000);
}

export function present(c: Cached, l: Locale, cached: boolean) {
  const T = t(l); const s = summarize(c.issues);
  const byRule = new Map<string, Issue[]>();
  for (const i of c.issues) { const a = byRule.get(i.ruleId) ?? []; if (a.length < 3) a.push(i); byRule.set(i.ruleId, a); }
  return {
    id: c.id, lang: l, url: c.url, scannedAt: c.scannedAt, cached, ageS: Math.max(0, Math.round((Date.now() - c.at) / 1000)),
    score: automatedScore({ ...s.counts, pages_scanned: 1 } as any), scoreLabel: T.mon.score, scoreNote: T.mon.scoreNote,
    total: s.total, counts: s.counts,
    byImpact: s.byImpact.map((g) => ({ impact: g.impact, label: T.impacts[g.impact] ?? g.impact, count: g.count,
      rules: g.rules.map(({ ruleId, help, helpUrl, wcag, count }) => ({ ruleId, help: ruleHelp(ruleId, help, l), helpUrl, wcag, count,
        wcagLinks: wcag.map(wcagLink), info: ruleInfo(ruleId, l),
        examples: (byRule.get(ruleId) ?? []).map((i) => ({ selector: i.target.slice(0, 300), html: i.html.slice(0, 300) })) })) })),
    note: T.automationNote,
  };
}
