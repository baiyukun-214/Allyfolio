import { randomUUID, createHash } from 'node:crypto';
import { get, all, run, now, tx } from '../db.ts';
import { planOf, pageCap } from '../lib/plans.ts';
import { scanPage, ruleHelp, type Issue } from '../lib/scanner.ts';
import { t } from '../i18n.ts';
import { sitemapUrls, normaliseLink } from '../lib/crawler.ts';
import { mailer } from '../lib/mailer.ts';
import { config } from '../config.ts';

export interface SiteScanPayload { siteId: string; kind: 'scheduled' | 'manual' | 'oneoff' }

export function evidenceHash(prevHash: string | null, scan: { id: string; siteId: string; finishedAt: string; pages: string[]; fingerprints: string[] }) {
  const canonical = JSON.stringify({ prev: prevHash ?? null, id: scan.id, site: scan.siteId, finished: scan.finishedAt, pages: [...scan.pages].sort(), issues: [...scan.fingerprints].sort() });
  return createHash('sha256').update(canonical).digest('hex');
}

export async function runSiteScan(p: SiteScanPayload, log: any = console): Promise<string | null> {
  const site = get<any>('SELECT s.*, t.plan, t.name AS team_name FROM sites s JOIN teams t ON t.id = s.team_id WHERE s.id = ?', p.siteId);
  if (!site || !site.verified_at) return null;
  const plan = planOf(site.plan);
  const cap = pageCap(plan, p.kind === 'oneoff');
  if (!cap) return null;
  const id = randomUUID();
  run("INSERT INTO scans (id, site_id, kind, status, created_at, started_at, page_limit) VALUES (?,?,?,'running',?,?,?)", id, site.id, p.kind, now(), now(), cap);

  const queue: string[] = [normaliseLink('/', site.origin)!, ...(await sitemapUrls(site.origin, cap))];
  const seen = new Set<string>(); const pages: { url: string; status: number | null; error?: string }[] = []; const issues: Issue[] = [];
  const next = () => { while (queue.length) { const u = queue.shift()!; if (!seen.has(u)) { seen.add(u); return u; } } return null; };
  try {
    while (pages.length < cap) {
      const batch: string[] = [];
      while (batch.length < config.scanConcurrency && pages.length + batch.length < cap) { const u = next(); if (!u) break; batch.push(u); }
      if (!batch.length) break;
      const results = await Promise.all(batch.map((u) => scanPage(u, { collectLinks: true }).catch((e) => ({ url: u, finalUrl: u, status: null, issues: [], links: [], error: String(e?.message ?? e) }))));
      for (const r of results) {
        pages.push({ url: r.url, status: r.status, error: r.error });
        issues.push(...r.issues);
        for (const l of r.links) { const n = normaliseLink(l, site.origin); if (n && !seen.has(n)) queue.push(n); }
      }
    }
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
      run(`UPDATE scans SET status='done', finished_at=?, pages_scanned=?, critical=?, serious=?, moderate=?, minor=?, new_issues=?, fixed_issues=?, prev_hash=?, evidence_hash=? WHERE id=?`,
        finishedAt, pages.length, counts.critical, counts.serious, counts.moderate, counts.minor, prev ? newIssues.length : null, prev ? fixed : null, prev?.evidence_hash ?? null, hash, id);
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
  for (const t of all<any>('SELECT id, plan FROM teams')) {
    const months = planOf(t.plan).retentionMonths;
    const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    n += Number(run('DELETE FROM scans WHERE site_id IN (SELECT id FROM sites WHERE team_id = ?) AND created_at < ?', t.id, cutoff.toISOString()).changes);
  }
  return n;
}
