import { randomUUID, createHash } from 'node:crypto';
import { get, all, run, now, tx } from '../db.ts';
import { planOf, pageCap, effectivePlanSql } from '../lib/plans.ts';
import { scanPage, ruleHelp, type Issue } from '../lib/scanner.ts';
import { t } from '../i18n.ts';
import { discover, loadRobots, robotsAllows, classifyLink, siteScope, pageKey, type SkipReason } from '../lib/crawler.ts';
import { mailer } from '../lib/mailer.ts';
import { config } from '../config.ts';

export interface SiteScanPayload { siteId: string; kind: 'scheduled' | 'manual' | 'oneoff' }

export function evidenceHash(prevHash: string | null, scan: { id: string; siteId: string; finishedAt: string; pages: string[]; fingerprints: string[] }) {
  const canonical = JSON.stringify({ prev: prevHash ?? null, id: scan.id, site: scan.siteId, finished: scan.finishedAt, pages: [...scan.pages].sort(), issues: [...scan.fingerprints].sort() });
  return createHash('sha256').update(canonical).digest('hex');
}

export async function runSiteScan(p: SiteScanPayload, log: any = console): Promise<string | null> {
  const site = get<any>(`SELECT s.*, ${effectivePlanSql()} AS plan, t.name AS team_name FROM sites s JOIN teams t ON t.id = s.team_id WHERE s.id = ?`, p.siteId);
  if (!site || !site.verified_at) return null;
  const plan = planOf(site.plan);
  const cap = pageCap(plan, p.kind === 'oneoff');
  if (!cap) return null;
  const id = randomUUID();
  run("INSERT INTO scans (id, site_id, kind, status, created_at, started_at, page_limit) VALUES (?,?,?,'running',?,?,?)", id, site.id, p.kind, now(), now(), cap);

  const scope = siteScope(site.origin), home = new URL('/', site.origin).href;
  const robots = await loadRobots(site.origin);
  const disc = await discover(site.origin, cap, robots);
  const skipped = new Map<SkipReason, Map<string, string>>();
  const skip = (reason: SkipReason, url: string) => { const m = skipped.get(reason) ?? new Map(); m.set(reason === 'other_host' || reason === 'file' ? url : pageKey(url), url); skipped.set(reason, m); };
  for (const x of disc.skipped) skip(x.reason, x.url);
  const queue: string[] = [home, ...disc.pages];
  const queued = new Set(queue.map(pageKey)), seen = new Set<string>(), scanned = new Set<string>();
  let fromLinks = 0;
  const pages: { url: string; status: number | null; error?: string }[] = []; const issues: Issue[] = [];
  const next = () => {
    while (queue.length) {
      const u = queue.shift()!, k = pageKey(u);
      if (seen.has(k)) continue;
      seen.add(k);
      // The start page is always scanned (the owner verified the site); everything else follows robots.txt.
      if (u !== home && robots && !robotsAllows(robots, u)) { skip('robots', u); continue; }
      return u;
    }
    return null;
  };
  try {
    while (pages.length < cap) {
      const batch: string[] = [];
      while (batch.length < config.scanConcurrency && pages.length + batch.length < cap) { const u = next(); if (!u) break; batch.push(u); }
      if (!batch.length) break;
      const results = await Promise.all(batch.map((u) => scanPage(u, { collectLinks: true }).catch((e) => ({ url: u, finalUrl: u, status: null, issues: [] as Issue[], links: [] as string[], error: String(e?.message ?? e) }))));
      for (const r of results) {
        if (r.error) { pages.push({ url: r.url, status: r.status, error: r.error }); skip('error', r.url); continue; }
        let final: URL; try { final = new URL(r.finalUrl); } catch { final = new URL(r.url); }
        if (!scope.hosts.has(final.hostname.toLowerCase())) { skip('redirect_away', r.url); continue; }
        const fk = pageKey(final.href);
        if (scanned.has(fk) || pages.length >= cap) { if (scanned.has(fk)) skip('duplicate', r.url); continue; }
        scanned.add(fk); seen.add(fk);
        pages.push({ url: final.href, status: r.status });
        issues.push(...r.issues);
        for (const l of r.links) {
          const c = classifyLink(l, final.href, scope); if (!c) continue;
          if ('skip' in c) { skip(c.skip, c.url); continue; }
          const k = pageKey(c.url); if (seen.has(k) || queued.has(k)) continue;
          queued.add(k); queue.push(c.url); fromLinks++;
        }
      }
      run('UPDATE scans SET pages_scanned = ? WHERE id = ?', pages.length, id); // live page counter for the dashboard
    }
    for (const u of queue) { const k = pageKey(u); if (!seen.has(k)) { seen.add(k); skip('limit', u); } }
    const crawl = {
      robots: robots ? (robots.rules.some((r) => !r.allow) ? 'rules' : 'found') : 'none',
      sitemapFiles: disc.sitemapFiles.slice(0, 10), sitemapFileCount: disc.sitemapFiles.length, sitemapUrls: disc.sitemapUrls, fromSitemap: disc.pages.length, fromLinks,
      skipped: Object.fromEntries([...skipped].map(([k, m]) => [k, { n: m.size, examples: [...m.values()].slice(0, 5) }])),
    };
    const prev = get<any>("SELECT id, evidence_hash FROM scans WHERE site_id = ? AND status = 'done' AND id != ? ORDER BY finished_at DESC LIMIT 1", site.id, id);
    const prevFps = new Set(prev ? all<any>('SELECT DISTINCT fingerprint FROM scan_issues WHERE scan_id = ?', prev.id).map((r) => r.fingerprint) : []);
    const curFps = new Set(issues.map((i) => i.fingerprint));
    const newIssues = issues.filter((i) => !prevFps.has(i.fingerprint));
    const fixed = [...prevFps].filter((f) => !curFps.has(f)).length;
    const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 } as Record<string, number>;
    for (const i of issues) counts[i.impact]++;
    const finishedAt = now();
    const hash = evidenceHash(prev?.evidence_hash ?? null, { id, siteId: site.id, finishedAt, pages: pages.map((p) => p.url), fingerprints: [...curFps] });
    tx(() => {
      for (const pg of pages) run('INSERT OR IGNORE INTO scan_pages (scan_id, url, status, error) VALUES (?,?,?,?)', id, pg.url, pg.status, pg.error ?? null);
      for (const i of issues) run('INSERT INTO scan_issues (scan_id, page_url, rule_id, impact, wcag, help, help_url, target, html, fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?)', id, i.pageUrl, i.ruleId, i.impact, i.wcag.join(', '), i.help, i.helpUrl, i.target, i.html, i.fingerprint);
      run(`UPDATE scans SET status='done', crawl=?, finished_at=?, pages_scanned=?, critical=?, serious=?, moderate=?, minor=?, new_issues=?, fixed_issues=?, prev_hash=?, evidence_hash=? WHERE id=?`,
        JSON.stringify(crawl), finishedAt, pages.length, counts.critical, counts.serious, counts.moderate, counts.minor, prev ? newIssues.length : null, prev ? fixed : null, prev?.evidence_hash ?? null, hash, id);
    });
    const newSerious = newIssues.filter((i) => i.impact === 'serious' || i.impact === 'critical');
    if (prev && newSerious.length) await alertTeam(site, id, newSerious);
    log.info?.({ scan: id, pages: pages.length, issues: issues.length }, 'site scan done');
    return id;
  } catch (e: any) {
    run("UPDATE scans SET status='failed', finished_at=?, error=? WHERE id=?", now(), String(e?.message ?? e).slice(0, 500), id);
    throw e;
  }
}

async function alertTeam(site: any, scanId: string, issues: Issue[]) {
  const members = all<any>('SELECT u.email, u.locale FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ?', site.team_id);
  const byRule = new Map<string, { help: string; n: number }>();
  for (const i of issues) { const r = byRule.get(i.ruleId) ?? { help: i.help, n: 0 }; r.n++; byRule.set(i.ruleId, r); }
  for (const m of members) {
    const M = t(m.locale).mon;
    const lines = [...byRule].slice(0, 10).map(([id, r]) => `- ${ruleHelp(id, r.help, m.locale ?? 'en')} (${r.n})`).join('\n');
    await mailer.send({ to: m.email, subject: M.alertSubject(issues.length, site.name), text: M.alertBody(site.origin, lines, `${config.appUrl}/app/scans/${scanId}`) });
  }
}

/** Delete scan history older than each team's plan retention (12 or 24 months). */
export function applyRetention(): number {
  let n = 0;
  for (const t of all<any>(`SELECT id, ${effectivePlanSql('teams')} AS plan FROM teams`)) {
    const months = planOf(t.plan).retentionMonths;
    const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    n += Number(run('DELETE FROM scans WHERE site_id IN (SELECT id FROM sites WHERE team_id = ?) AND created_at < ?', t.id, cutoff.toISOString()).changes);
  }
  return n;
}
