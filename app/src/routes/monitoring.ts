import type { FastifyInstance, FastifyRequest } from 'fastify';
import { all, get, run } from '../db.ts';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import type { Ctx } from '../lib/auth.ts';
import { planOf, canPdf } from '../lib/plans.ts';
import { enqueue, hasPendingScan } from '../jobs/queue.ts';
import { IMPACTS, ruleHelp } from '../lib/scanner.ts';
import { requireUser, render, back, ownSite, loc, T, fmtDate, localTime } from './guard.ts';
import { t, scanError, REPORT_LOCALES, type Locale } from '../i18n.ts';
import { scanSummary, coverageSection, guidance, ruleTitle, snippet } from '../lib/scanSummary.ts';
/** Affected elements listed per rule on the scan page. */
const APP_ELEMENTS = 200;
import { automatedScore, weeklyTrend, totalIssues } from '../lib/insights.ts';
import { scoreBlock, sparkline, sevChips, emptyState } from '../views/ui.ts';
import { checklist, summary as manualSummary } from '../lib/manualReview.ts';

export const fmt = (iso?: string | null, l: Locale = 'en') => fmtDate(iso, l);
const lt = (iso?: string | null, l: Locale = 'en') => localTime(iso, l);
const note = (l: Locale) => { const M = t(l).mon; return html`<p class="notice"><strong>${M.note}</strong> ${M.noteText}</p>`; };

export function siteDetailExtras(req: FastifyRequest, ctx: Ctx, s: any) {
  const l = loc(req, ctx), Tx = t(l), M = Tx.mon;
  const plan = planOf(ctx.team.plan);
  const scans = all<any>('SELECT * FROM scans WHERE site_id = ? ORDER BY created_at DESC LIMIT 100', s.id);
  const pending = hasPendingScan(s.id);
  const done = scans.filter((c) => c.status === 'done');
  const latest = done[0]; const tr = weeklyTrend(done);
  const running = scans.find((c) => c.status === 'running');
  const scanBtn = plan.frequency ? html`<form method="post" action="/app/sites/${s.id}/scan" data-scan-form data-status-url="/app/sites/${s.id}/scan-status">${csrfField(req)}<button class="btn btn-primary" type="submit" ${pending || running ? html`disabled aria-busy="true"` : ''}>${running ? M.scanningBtn : pending ? M.queued : M.scanNow}</button></form>` : '';
  return html`
    ${latest ? html`<section class="kpis" aria-label="${M.status}" id="kpis">
      <div class="card kpi kpi-score">${scoreBlock('site-score', automatedScore(latest), M)}</div>
      <div class="card kpi"><p class="muted small">${M.openIssues} <span class="sub">· ${M.openSub}</span></p><p class="stat" data-to="${totalIssues(latest)}">${totalIssues(latest)}</p>${sevChips(latest, Tx.impacts)}</div>
      <div class="card kpi"><p class="muted small">${M.fixedWeek} <span class="sub">· ${M.fixedSub}</span></p><p class="stat" data-to="${tr.fixedWeek}">${tr.fixedWeek}</p></div>
      <div class="card kpi"><p class="muted small">${M.trend}</p>${sparkline(tr.series, M.trendAria)}<p class="small ${tr.delta !== null && tr.delta < 0 ? 'good' : 'muted'}">${tr.delta === null ? M.trendNone : M.trendDelta(tr.delta)}</p></div>
    </section>` : ''}
    <section class="facts" aria-label="${M.schedule}">
      <p><span class="muted small">${M.schedule}</span> <strong>${plan.frequency ? (plan.frequency === 'daily' ? M.daily : M.weekly) : M.none}</strong> <span class="small muted">${M.next}: ${lt(s.next_scan_at, l)}</span></p>
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
    <template id="scan-i18n" data-starting="${M.scanStarting}" data-scanning="${M.scanning('{n}' as any, '{limit}' as any)}" data-failed="${M.scanFailed}" data-view="${M.viewScan}" data-dismiss="${M.dismiss}" data-done="${M.scanDone('{n}' as any, '{f}' as any)}" data-btn-scan="${M.scanNow}" data-btn-queued="${M.queued}" data-btn-scanning="${M.scanningBtn}"></template>
    ${manualSection(s, l)}
    <section id="history" aria-labelledby="history-h"><h2 id="history-h">${M.historyH}</h2>
    ${scans.length ? html`<div class="card table-wrap" style="padding:8px 16px"><table><caption class="sr-only">${M.historyCaption}</caption>
      <thead><tr><th scope="col">${M.colFinished}</th><th scope="col">${M.colType}</th><th scope="col">${M.colPages}</th><th scope="col">${M.colCounts}</th><th scope="col">${M.colDiff}</th><th scope="col">${M.colHash}</th></tr></thead><tbody>
      ${scans.map((c) => html`<tr><td>${c.status === 'done' ? html`<a href="/app/scans/${c.id}">${lt(c.finished_at, l)}</a>` : html`<span class="pill">${M.statuses[c.status] ?? c.status}</span>`}</td><td>${M.kinds[c.kind] ?? c.kind}</td><td>${c.pages_scanned}</td>
        <td>${sevChips(c, Tx.impacts)}</td><td>${c.new_issues ?? '–'} / ${c.fixed_issues ?? '–'}</td><td><code>${(c.evidence_hash ?? '').slice(0, 12)}</code></td></tr>`)}
    </tbody></table></div>` : emptyState(M.emptyScansH, M.emptyScansText + (pending ? M.firstQueued : ''))}</section>
    <p class="small muted" style="margin-top:24px">${M.removeInSettings} <a href="/app/settings#danger-h">${M.settingsLink}</a>.</p>`;
}

function manualSection(s: any, l: Locale) {
  const X = t(l).manual, sm = manualSummary(s.id), failing = checklist(s.id).filter((r) => r.status === 'fail');
  return html`<section class="card" aria-labelledby="manual-h" style="margin-top:24px"><h2 id="manual-h" style="margin-top:0">${X.h}</h2>
    <p class="small muted">${X.lead}</p><p>${X.summary(sm)}</p>
    ${failing.length ? html`<p class="small"><strong>${X.failing}:</strong> ${failing.map((r) => r.criterion).join(', ')}</p>` : ''}
    <p><a class="btn btn-secondary" href="/app/sites/${s.id}/manual">${X.open}</a></p></section>
  ${emailCard(s, l)}`;
}

function emailCard(s: any, l: Locale) {
  const E = t(l).er, n = get<any>('SELECT COUNT(*) AS n FROM report_schedules WHERE site_id = ? AND active = 1', s.id).n;
  return html`<section class="card" aria-labelledby="er-h" style="margin-top:24px"><h2 id="er-h" style="margin-top:0">${E.h}</h2>
    <p class="small muted">${E.schedH}: ${n ? `${n} ${E.active.toLowerCase()}` : E.schedNone}</p>
    <p><a class="btn btn-secondary" href="/app/sites/${s.id}/email-reports">${E.open}</a></p></section>`;
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
    const S = scanSummary(scan.id), C = Tx.cov;
    const newIn = (r: { elements: { fingerprint: string }[] }) => prev ? r.elements.filter((e) => !prevFps.has(e.fingerprint)).length : 0;
    const plan = planOf(ctx.team.plan);
    const d = M.diff(scan.new_issues, scan.fixed_issues);
    return render(reply, ctx, { title: M.scanOf(scan.site_name), current: '/app', body: html`
      <p><a href="/app/sites/${scan.sid}">← ${scan.site_name}</a></p>
      <h1>${M.scanOf(scan.site_name)}</h1>
      <p class="muted">${M.finished} ${lt(scan.finished_at, l)} · ${M.pagesN(scan.pages_scanned)} (${M.limit} ${scan.page_limit}) · ${M.hash} <code>${scan.evidence_hash}</code></p>
      ${canPdf(plan, scan.kind === 'oneoff') ? html`<div class="row"><a class="btn btn-primary" href="/app/scans/${scan.id}/report.pdf">${M.pdf}</a><a class="btn btn-secondary" href="/app/scans/${scan.id}/report">${M.printable}</a></div>
      <p class="small" style="margin-top:8px">${C.reportLang}: ${REPORT_LOCALES.map((rl, i) => html`${i ? ' · ' : ''}<a href="/app/scans/${scan.id}/report.pdf?language=${rl}" hreflang="${t(rl).htmlLang}" lang="${t(rl).htmlLang}">${t(rl).langName} (PDF)</a>`)}</p>` : ''}
      <p style="margin-top:16px"><strong data-counts>${C.counts(S.elements, S.rules, S.occurrences, S.pagesWithIssues)}</strong></p>
      <p class="small muted">${C.countsHelp}</p>
      <p class="small" style="margin:16px 0 0"><strong>${C.byImpact}</strong></p>
      <dl class="grid g4" style="margin-top:8px">${IMPACTS.map((k) => html`<div class="card imp-${k}" style="border:0"><dt class="small">${Tx.impacts[k]}</dt><dd class="stat" style="margin:0">${scan[k]}</dd></div>`)}</dl>
      <div class="card kpi-score" style="margin-top:16px">${scoreBlock('scan-score', automatedScore(scan), M)}</div>
      ${prev ? html`<p class="small" style="margin-top:12px"><strong>${d[0]}</strong>${d[1]}<strong>${d[2]}</strong>${d[3]}</p>` : html`<p class="small muted" style="margin-top:12px">${M.first}</p>`}
      ${unscanned.length ? html`<section class="card alert" aria-labelledby="unscanned-h" style="margin-top:16px"><h2 id="unscanned-h">${Tx.scanErrors.unscannedH}</h2><ul>${unscanned.map((p: any) => { const se = scanError(l, p.error); return html`<li data-code="${se.code}"><code>${new URL(p.url).pathname}</code> – ${se.error}</li>`; })}</ul></section>` : ''}
      ${note(l)}
      <h2>${M.byRule}</h2>
      ${S.byRule.map((r) => { const isNew = newIn(r); return html`
        <details class="card" style="margin-bottom:8px" data-rule="${r.ruleId}"><summary><span class="pill imp-${r.impact}">${Tx.impacts[r.impact] ?? r.impact}</span> <strong>${ruleTitle(r, l)}</strong> – ${M.elements(r.elements.length)} · ${M.pagesN(r.pages)}${isNew ? html` · <span class="pill">${M.newN(isNew)}</span>` : ''}</summary>
          <p class="small muted" style="margin-top:8px">${r.wcag || M.bestPractice} · <code>${r.ruleId}</code></p>
          <div class="small">${guidance(r, l)}</div>
          <div class="table-wrap"><table><caption class="sr-only">${C.elementsCaption(ruleTitle(r, l))}</caption><thead><tr><th scope="col">${C.colPageUrl}</th><th scope="col">${C.colSelector}</th><th scope="col">${C.colHtml}</th></tr></thead><tbody>
          ${r.elements.slice(0, APP_ELEMENTS).map((n) => html`<tr><td><a href="${n.pageUrl}">${n.pageUrl}</a></td><td><code>${n.target}</code></td><td><code class="snippet">${snippet(n.html, 600)}</code></td></tr>`)}</tbody></table></div>
          ${r.elements.length > APP_ELEMENTS ? html`<p class="small muted">${M.more(r.elements.length - APP_ELEMENTS)}</p>` : ''}
        </details>`; })}
      ${S.byPage.length ? html`<h2>${C.topPages}</h2><div class="table-wrap"><table><caption class="sr-only">${C.topPages}</caption><thead><tr><th scope="col">${M.colPage}</th><th scope="col">${C.colElements}</th><th scope="col">${C.colRules}</th></tr></thead><tbody>
        ${S.byPage.slice(0, 100).map((p) => html`<tr><td><a href="${p.url}">${p.url}</a></td><td>${p.elements}</td><td>${p.rules}</td></tr>`)}</tbody></table></div>` : ''}
      <div class="card" style="margin-top:16px">${coverageSection(scan, l, 'coverage-h')}</div>
      ${!issues.length ? html`<p>${M.noIssues}</p>` : ''}
      ${fixed.length ? html`<h2>${M.fixedH}</h2><ul>${[...new Map(fixed.map((f) => [f.rule_id + f.target, f])).values()].slice(0, 100).map((f: any) => html`<li>${ruleHelp(f.rule_id, f.help, l)} – <code>${f.target}</code> ${M.on} ${new URL(f.page_url).pathname}</li>`)}</ul>` : ''}` });
  });
}
