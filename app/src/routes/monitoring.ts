import type { FastifyInstance, FastifyRequest } from 'fastify';
import { all, get, run } from '../db.ts';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import type { Ctx } from '../lib/auth.ts';
import { planOf, canPdf } from '../lib/plans.ts';
import { enqueue, hasPendingScan } from '../jobs/queue.ts';
import { IMPACTS, ruleHelp } from '../lib/scanner.ts';
import { requireUser, render, back, ownSite, loc, T, fmtDate } from './guard.ts';
import { t, scanError, type Locale } from '../i18n.ts';
import { automatedScore, weeklyTrend, totalIssues } from '../lib/insights.ts';
import { scoreBlock, sparkline, sevChips, emptyState } from '../views/ui.ts';

export const fmt = (iso?: string | null, l: Locale = 'en') => fmtDate(iso, l);
const note = (l: Locale) => { const M = t(l).mon; return html`<p class="notice"><strong>${M.note}</strong> ${M.noteText}</p>`; };

export function siteDetailExtras(req: FastifyRequest, ctx: Ctx, s: any) {
  const l = loc(req, ctx), Tx = t(l), M = Tx.mon;
  const plan = planOf(ctx.team.plan);
  const scans = all<any>('SELECT * FROM scans WHERE site_id = ? ORDER BY created_at DESC LIMIT 100', s.id);
  const pending = hasPendingScan(s.id);
  const done = scans.filter((c) => c.status === 'done');
  const latest = done[0]; const tr = weeklyTrend(done);
  const running = scans.find((c) => c.status === 'running');
  const scanBtn = plan.frequency ? html`<form method="post" action="/app/sites/${s.id}/scan" data-scan-form data-status-url="/app/sites/${s.id}/scan-status">${csrfField(req)}<button class="btn btn-primary" type="submit" ${pending ? 'disabled' : ''}>${pending ? M.queued : M.scanNow}</button></form>` : '';
  return html`
    ${latest ? html`<section class="kpis" aria-label="${M.status}" id="kpis">
      <div class="card kpi kpi-score">${scoreBlock('site-score', automatedScore(latest), M)}</div>
      <div class="card kpi"><p class="muted small">${M.openIssues} <span class="sub">· ${M.openSub}</span></p><p class="stat" data-to="${totalIssues(latest)}">${totalIssues(latest)}</p>${sevChips(latest, Tx.impacts)}</div>
      <div class="card kpi"><p class="muted small">${M.fixedWeek} <span class="sub">· ${M.fixedSub}</span></p><p class="stat" data-to="${tr.fixedWeek}">${tr.fixedWeek}</p></div>
      <div class="card kpi"><p class="muted small">${M.trend}</p>${sparkline(tr.series, M.trendAria)}<p class="small ${tr.delta !== null && tr.delta < 0 ? 'good' : 'muted'}">${tr.delta === null ? M.trendNone : M.trendDelta(tr.delta)}</p></div>
    </section>` : ''}
    <section class="facts" aria-label="${M.schedule}">
      <p><span class="muted small">${M.schedule}</span> <strong>${plan.frequency ? (plan.frequency === 'daily' ? M.daily : M.weekly) : M.none}</strong> <span class="small muted">${M.next}: ${fmt(s.next_scan_at, l)}</span></p>
      <p><span class="muted small">${M.pageLimit}</span> <strong>${plan.pagesPerSite || '–'}</strong> <span class="small muted">${M.planSuffix(Tx.plans[plan.id] ?? plan.name)}</span></p>
      <p><span class="muted small">${M.history}</span> <strong>${M.months(plan.retentionMonths)}</strong> <span class="small muted">${M.appendOnly}</span></p>
    </section>
    <div class="row" style="margin-top:16px">
      ${scanBtn}
      ${ctx.team.oneoff_credits > 0 ? html`<form method="post" action="/app/sites/${s.id}/oneoff">${csrfField(req)}<button class="btn btn-secondary" type="submit" ${pending ? 'disabled' : ''}>${M.oneoff(ctx.team.oneoff_credits)}</button></form>` : ''}
      ${plan.statement ? html`<a class="btn btn-secondary" href="/app/sites/${s.id}/statement">${M.statementBtn}</a>` : ''}
    </div>
    <div class="scan-progress" id="scan-progress" ${running ? '' : 'hidden'}><p class="small" id="scan-progress-text">${running ? M.scanning(running.pages_scanned ?? 0, running.page_limit ?? plan.pagesPerSite) : M.scanStarting}</p>
      <div class="prog" role="progressbar" aria-label="${M.progressLabel}" aria-valuemin="0" aria-valuemax="${running?.page_limit ?? plan.pagesPerSite ?? 0}" aria-valuenow="${running?.pages_scanned ?? 0}"><span style="width:${running ? Math.round(100 * (running.pages_scanned ?? 0) / Math.max(1, running.page_limit ?? 1)) : 0}%"></span></div></div>
    <template id="scan-i18n" data-starting="${M.scanStarting}" data-scanning="${M.scanning('{n}' as any, '{limit}' as any)}" data-failed="${M.scanFailed}" data-view="${M.viewScan}" data-dismiss="${M.dismiss}" data-done="${M.scanDone('{n}' as any, '{f}' as any)}"></template>
    <section id="history" aria-labelledby="history-h"><h2 id="history-h">${M.historyH}</h2>
    ${scans.length ? html`<div class="card table-wrap" style="padding:8px 16px"><table><caption class="sr-only">${M.historyCaption}</caption>
      <thead><tr><th scope="col">${M.colFinished}</th><th scope="col">${M.colType}</th><th scope="col">${M.colPages}</th><th scope="col">${M.colCounts}</th><th scope="col">${M.colDiff}</th><th scope="col">${M.colHash}</th></tr></thead><tbody>
      ${scans.map((c) => html`<tr><td>${c.status === 'done' ? html`<a href="/app/scans/${c.id}">${fmt(c.finished_at, l)}</a>` : html`<span class="pill">${M.statuses[c.status] ?? c.status}</span>`}</td><td>${M.kinds[c.kind] ?? c.kind}</td><td>${c.pages_scanned}</td>
        <td>${sevChips(c, Tx.impacts)}</td><td>${c.new_issues ?? '–'} / ${c.fixed_issues ?? '–'}</td><td><code>${(c.evidence_hash ?? '').slice(0, 12)}</code></td></tr>`)}
    </tbody></table></div>` : emptyState(M.emptyScansH, M.emptyScansText + (pending ? M.firstQueued : ''))}</section>
    <p class="small muted" style="margin-top:24px">${M.removeInSettings} <a href="/app/settings#danger-h">${M.settingsLink}</a>.</p>`;
}

export async function monitoringRoutes(app: FastifyInstance) {
  app.post('/app/sites/:id/scan', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const M = T(req, ctx).mon;
    const s = ownSite(ctx, (req.params as any).id); if (!s?.verified_at) return reply.code(404).send();
    if (!planOf(ctx.team.plan).frequency) return back(reply, `/app/sites/${s.id}`, 'err', M.choosePlan);
    if (!hasPendingScan(s.id)) enqueue('site_scan', { siteId: s.id, kind: 'manual' });
    if (String(req.headers.accept ?? '').includes('application/json')) return reply.send({ ok: true });
    return back(reply, `/app/sites/${s.id}`, 'ok', M.scanQueuedMsg);
  });
  // Small JSON status for the "Scan now" progress bar (public/app.js). No issue details, only counts.
  app.get('/app/sites/:id/scan-status', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send({ error: 'not found' });
    const r = get<any>("SELECT pages_scanned, page_limit FROM scans WHERE site_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1", s.id);
    const last = get<any>("SELECT id, status, finished_at, new_issues, fixed_issues FROM scans WHERE site_id = ? AND status IN ('done','failed') ORDER BY created_at DESC LIMIT 1", s.id);
    return reply.header('cache-control', 'no-store').send({ pending: hasPendingScan(s.id), running: r ? { pages: r.pages_scanned ?? 0, limit: r.page_limit ?? 0 } : null,
      last: last ? { id: last.id, status: last.status, finishedAt: last.finished_at, newIssues: last.new_issues ?? 0, fixedIssues: last.fixed_issues ?? 0 } : null });
  });
  app.post('/app/sites/:id/oneoff', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const M = T(req, ctx).mon;
    const s = ownSite(ctx, (req.params as any).id); if (!s?.verified_at) return reply.code(404).send();
    const ok = run('UPDATE teams SET oneoff_credits = oneoff_credits - 1 WHERE id = ? AND oneoff_credits > 0', ctx.team.id).changes;
    if (!ok) return back(reply, `/app/sites/${s.id}`, 'err', M.noCredit);
    enqueue('site_scan', { siteId: s.id, kind: 'oneoff' });
    return back(reply, `/app/sites/${s.id}`, 'ok', M.oneoffQueued);
  });

  app.get('/app/scans/:id', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const l = loc(req, ctx), Tx = t(l), M = Tx.mon;
    const scan = get<any>('SELECT c.*, s.name AS site_name, s.origin, s.id AS sid FROM scans c JOIN sites s ON s.id = c.site_id WHERE c.id = ? AND s.team_id = ?', (req.params as any).id, ctx.team.id);
    if (!scan) return render(reply, ctx, { title: M.scanNotFound, body: html`<h1>${M.scanNotFound}</h1>` }, 404);
    const issues = all<any>('SELECT * FROM scan_issues WHERE scan_id = ? ORDER BY id', scan.id);
    const unscanned = all<any>('SELECT url, error FROM scan_pages WHERE scan_id = ? AND error IS NOT NULL ORDER BY url LIMIT 50', scan.id);
    const prev = get<any>("SELECT id FROM scans WHERE site_id = ? AND status = 'done' AND finished_at < ? ORDER BY finished_at DESC LIMIT 1", scan.site_id, scan.finished_at);
    const prevFps = new Set(prev ? all<any>('SELECT fingerprint FROM scan_issues WHERE scan_id = ?', prev.id).map((r) => r.fingerprint) : []);
    const fixed = prev ? all<any>('SELECT * FROM scan_issues WHERE scan_id = ? AND fingerprint NOT IN (SELECT fingerprint FROM scan_issues WHERE scan_id = ?)', prev.id, scan.id) : [];
    const rules = new Map<string, any>();
    for (const i of issues) { const r = rules.get(i.rule_id) ?? { ...i, nodes: [], isNew: 0 }; r.nodes.push(i); if (prev && !prevFps.has(i.fingerprint)) r.isNew++; rules.set(i.rule_id, r); }
    const plan = planOf(ctx.team.plan);
    const d = M.diff(scan.new_issues, scan.fixed_issues);
    return render(reply, ctx, { title: M.scanOf(scan.site_name), current: '/app', body: html`
      <p><a href="/app/sites/${scan.sid}">← ${scan.site_name}</a></p>
      <h1>${M.scanOf(scan.site_name)}</h1>
      <p class="muted">${M.finished} ${fmt(scan.finished_at, l)} · ${M.pagesN(scan.pages_scanned)} (${M.limit} ${scan.page_limit}) · ${M.hash} <code>${scan.evidence_hash}</code></p>
      <div class="row">${canPdf(plan, scan.kind === 'oneoff') ? html`<a class="btn btn-primary" href="/app/scans/${scan.id}/report.pdf">${M.pdf}</a>` : ''}<a class="btn btn-secondary" href="/app/scans/${scan.id}/report">${M.printable}</a></div>
      <dl class="grid g4" style="margin-top:16px">${IMPACTS.map((k) => html`<div class="card imp-${k}" style="border:0"><dt class="small">${Tx.impacts[k]}</dt><dd class="stat" style="margin:0">${scan[k]}</dd></div>`)}</dl>
      <div class="card kpi-score" style="margin-top:16px">${scoreBlock('scan-score', automatedScore(scan), M)}</div>
      ${prev ? html`<p class="small" style="margin-top:12px"><strong>${d[0]}</strong>${d[1]}<strong>${d[2]}</strong>${d[3]}</p>` : html`<p class="small muted" style="margin-top:12px">${M.first}</p>`}
      ${unscanned.length ? html`<section class="card alert" aria-labelledby="unscanned-h" style="margin-top:16px"><h2 id="unscanned-h">${Tx.scanErrors.unscannedH}</h2><ul>${unscanned.map((p: any) => { const se = scanError(l, p.error); return html`<li data-code="${se.code}"><code>${new URL(p.url).pathname}</code> – ${se.error}</li>`; })}</ul></section>` : ''}
      ${note(l)}
      <h2>${M.byRule}</h2>
      ${[...rules.values()].sort((a, b) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact)).map((r) => html`
        <details class="card" style="margin-bottom:8px"><summary><span class="pill imp-${r.impact}">${Tx.impacts[r.impact] ?? r.impact}</span> <strong>${ruleHelp(r.rule_id, r.help, l)}</strong> – ${M.elements(r.nodes.length)}${r.isNew ? html` · <span class="pill">${M.newN(r.isNew)}</span>` : ''}</summary>
          <p class="small muted" style="margin-top:8px">${r.wcag || M.bestPractice} · <a href="${r.help_url}">${M.howFix}</a></p>
          <div class="table-wrap"><table><caption class="sr-only">${M.affected}</caption><thead><tr><th scope="col">${M.colPage}</th><th scope="col">${M.colElement}</th></tr></thead><tbody>
          ${r.nodes.slice(0, 50).map((n: any) => html`<tr><td>${new URL(n.page_url).pathname}</td><td><code>${n.target}</code></td></tr>`)}</tbody></table></div>
          ${r.nodes.length > 50 ? html`<p class="small muted">${M.more(r.nodes.length - 50)}</p>` : ''}
        </details>`)}
      ${!issues.length ? html`<p>${M.noIssues}</p>` : ''}
      ${fixed.length ? html`<h2>${M.fixedH}</h2><ul>${[...new Map(fixed.map((f) => [f.rule_id + f.target, f])).values()].slice(0, 100).map((f: any) => html`<li>${ruleHelp(f.rule_id, f.help, l)} – <code>${f.target}</code> ${M.on} ${new URL(f.page_url).pathname}</li>`)}</ul>` : ''}` });
  });
}
