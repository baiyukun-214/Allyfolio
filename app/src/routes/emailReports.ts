import { clientOfSite } from '../lib/clients.ts';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { all, get, run, now } from '../db.ts';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import { planOf } from '../lib/plans.ts';
import { t, normLocale, type Locale } from '../i18n.ts';
import { enqueue } from '../jobs/queue.ts';
import { requireUser, render, back, ownSite, loc, T, localTime, pg } from './guard.ts';
import { parseRecipients, nextRunAt, unsubOk, unsubscribe, manualSendsToday, MANUAL_SENDS_PER_DAY, SCHEDULES_PER_TEAM, type Frequency } from '../lib/reportMail.ts';

const LOCALES: Locale[] = ['en', 'zh-CN'];
const recipientsError = (E: any, r: any) => r.reason === 'empty' ? E.errEmpty : r.reason === 'tooMany' ? E.errTooMany : E.errInvalid(r.value ?? '');

export async function emailReportRoutes(app: FastifyInstance) {
  app.get('/app/sites/:id/email-reports', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const l = loc(req, ctx), Tx = t(l), E = Tx.er;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send('Not found');
    const allowed = planOf(ctx.team.plan).pdf && !!s.verified_at;
    const hasScan = !!get("SELECT 1 FROM scans WHERE site_id = ? AND status = 'done'", s.id);
    const schedules = all<any>('SELECT * FROM report_schedules WHERE site_id = ? ORDER BY created_at', s.id);
    const deliveries = all<any>('SELECT d.*, u.email AS sent_by_email FROM report_deliveries d LEFT JOIN users u ON u.id = d.sent_by WHERE d.site_id = ? ORDER BY d.created_at DESC LIMIT 30', s.id);
    const contact = clientOfSite(s.id)?.contact_email ?? '';
    const langSelect = (id: string) => html`<select id="${id}" name="locale">${LOCALES.map((x) => html`<option value="${x}" ${x === l ? 'selected' : ''}>${t(x).langName}</option>`)}</select>`;
    return render(reply, ctx, { title: `${E.h} – ${s.name}`, current: '/app', body: html`
      <p><a href="/app/sites/${s.id}">${E.back}</a></p>
      <h1>${E.h}</h1><p class="muted">${s.name} · ${s.origin}</p><p>${E.lead}</p>
      ${!allowed ? html`<p class="notice">${planOf(ctx.team.plan).pdf ? Tx.manual.notVerified : E.gate}</p>` : html`
      <p class="notice">${E.consent}</p>
      <section class="card" aria-labelledby="send-h"><h2 id="send-h" style="margin-top:0">${E.sendH}</h2>
        ${hasScan ? html`<form method="post" action="/app/sites/${s.id}/email-reports/send">${csrfField(req)}
          <div class="field"><label for="send-to">${E.recipients}</label><input id="send-to" name="recipients" type="text" autocomplete="off" required value="${contact}" aria-describedby="send-hint"><p id="send-hint" class="small muted">${E.recipientsHint}</p></div>
          <div class="field"><label for="send-lang">${E.language}</label>${langSelect('send-lang')}</div>
          <button class="btn btn-primary" type="submit">${E.send}</button></form>` : html`<p>${E.noScan}</p>`}
      </section>
      <section class="card" aria-labelledby="sched-h" style="margin-top:24px"><h2 id="sched-h" style="margin-top:0">${E.schedH}</h2><p class="small muted">${E.schedLead}</p>
        ${schedules.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-labelledby="sched-h"><table><thead><tr><th scope="col">${E.colRecipients}</th><th scope="col">${E.colFrequency}</th><th scope="col">${E.colLanguage}</th><th scope="col">${E.colNext}</th><th scope="col">${E.colLast}</th><th scope="col">${E.colStatus}</th><th scope="col">${E.colActions}</th></tr></thead><tbody>
          ${schedules.map((r) => { const who = r.recipients.split(',').join(', ') || '–'; return html`<tr><td>${who}</td><td>${E.freq[r.frequency]}</td><td>${t(normLocale(r.locale) ?? 'en').langName}</td>
            <td>${r.active ? localTime(r.next_run_at, l) : '–'}</td><td>${localTime(r.last_run_at, l)}</td><td>${r.active ? E.active : E.paused}</td>
            <td><form method="post" action="/app/sites/${s.id}/email-reports/${r.id}/toggle" style="display:inline">${csrfField(req)}<button class="btn btn-secondary" type="submit" aria-label="${E.actionFor(r.active ? E.pause : E.resume, who)}">${r.active ? E.pause : E.resume}</button></form>
            <form method="post" action="/app/sites/${s.id}/email-reports/${r.id}/delete" style="display:inline">${csrfField(req)}<button class="btn btn-secondary" type="submit" aria-label="${E.actionFor(E.del, who)}">${E.del}</button></form></td></tr>`; })}
        </tbody></table></div>` : html`<p>${E.schedNone}</p>`}
        <form method="post" action="/app/sites/${s.id}/email-reports/schedules" style="margin-top:16px">${csrfField(req)}
          <div class="field"><label for="sched-to">${E.recipients}</label><input id="sched-to" name="recipients" type="text" autocomplete="off" required value="${contact}" aria-describedby="sched-hint"><p id="sched-hint" class="small muted">${E.recipientsHint}</p></div>
          <div class="field"><label for="sched-freq">${E.frequency}</label><select id="sched-freq" name="frequency"><option value="weekly">${E.freq.weekly}</option><option value="monthly">${E.freq.monthly}</option></select></div>
          <div class="field"><label for="sched-lang">${E.language}</label>${langSelect('sched-lang')}</div>
          <button class="btn btn-primary" type="submit">${E.add}</button></form>
      </section>`}
      <section aria-labelledby="deliv-h" style="margin-top:24px"><h2 id="deliv-h">${E.delivH}</h2>
        ${deliveries.length ? html`<div class="card table-wrap" style="padding:8px 16px" tabindex="0" role="region" aria-labelledby="deliv-h"><table><thead><tr><th scope="col">${E.colWhen}</th><th scope="col">${E.colKind}</th><th scope="col">${E.colRecipients}</th><th scope="col">${E.colResult}</th></tr></thead><tbody>
          ${deliveries.map((d) => html`<tr><td class="small">${localTime(d.created_at, l)}</td><td>${E.kinds[d.kind]}${d.sent_by_email ? html`<br><span class="small muted">${d.sent_by_email}</span>` : ''}</td><td>${d.recipient.split(',').join(', ')}</td>
            <td>${E.results[d.status]}${d.status === 'skipped' && d.error ? html` <span class="small muted">(${E.reasons[d.error] ?? d.error})</span>` : d.status === 'failed' ? html` <span class="small muted">(${String(d.error ?? '').slice(0, 120)})</span>` : ''}</td></tr>`)}
        </tbody></table></div>` : html`<p>${E.delivNone}</p>`}
      </section>` });
  });

  const guardSite = (req: any, reply: any) => {
    const ctx = requireUser(req, reply); if (!ctx) return null;
    const E = T(req, ctx).er, s = ownSite(ctx, req.params.id);
    if (!s) { reply.code(404).send('Not found'); return null; }
    const path = `/app/sites/${s.id}/email-reports`;
    if (!planOf(ctx.team.plan).pdf || !s.verified_at) { back(reply, path, 'err', E.gate); return null; }
    return { ctx, s, E, path };
  };

  app.post('/app/sites/:id/email-reports/send', async (req, reply) => {
    const g = guardSite(req, reply); if (!g) return; const { ctx, s, E, path } = g;
    const body = (req.body ?? {}) as any;
    const r = parseRecipients(body.recipients); if (!r.ok) return back(reply, path, 'err', recipientsError(E, r));
    if (!get("SELECT 1 FROM scans WHERE site_id = ? AND status = 'done'", s.id)) return back(reply, path, 'err', E.noScan);
    const pendingN = all<any>("SELECT payload FROM jobs WHERE type = 'report_email_now' AND status IN ('queued','running')").map((j) => JSON.parse(j.payload)).filter((p) => p.teamId === ctx.team.id).reduce((n, p) => n + p.recipients.length, 0);
    if (manualSendsToday(ctx.team.id) + pendingN + r.list.length > MANUAL_SENDS_PER_DAY) return back(reply, path, 'err', E.limit(MANUAL_SENDS_PER_DAY));
    enqueue('report_email_now', { siteId: s.id, teamId: ctx.team.id, recipients: r.list, locale: normLocale(body.locale) ?? 'en', sentBy: ctx.user.id });
    return back(reply, path, 'ok', E.queued(r.list.length));
  });

  app.post('/app/sites/:id/email-reports/schedules', async (req, reply) => {
    const g = guardSite(req, reply); if (!g) return; const { ctx, s, E, path } = g;
    const body = (req.body ?? {}) as any;
    const r = parseRecipients(body.recipients); if (!r.ok) return back(reply, path, 'err', recipientsError(E, r));
    const freq: Frequency = body.frequency === 'monthly' ? 'monthly' : 'weekly';
    if (get<any>('SELECT COUNT(*) AS n FROM report_schedules WHERE team_id = ?', ctx.team.id).n >= SCHEDULES_PER_TEAM) return back(reply, path, 'err', E.tooMany(SCHEDULES_PER_TEAM));
    run('INSERT INTO report_schedules (id, team_id, site_id, recipients, frequency, locale, active, next_run_at, created_by, created_at) VALUES (?,?,?,?,?,?,1,?,?,?)',
      randomUUID(), ctx.team.id, s.id, r.list.join(','), freq, normLocale(body.locale) ?? 'en', nextRunAt(freq), ctx.user.id, now());
    return back(reply, path, 'ok', E.added);
  });

  app.post('/app/sites/:id/email-reports/:sid/toggle', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const E = T(req, ctx).er;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send('Not found');
    const sc = get<any>('SELECT * FROM report_schedules WHERE id = ? AND site_id = ?', (req.params as any).sid, s.id); if (!sc) return reply.code(404).send('Not found');
    const path = `/app/sites/${s.id}/email-reports`;
    if (!sc.active && !planOf(ctx.team.plan).pdf) return back(reply, path, 'err', E.gate);
    if (!sc.active && !sc.recipients) return back(reply, path, 'err', E.noRecipients);
    run('UPDATE report_schedules SET active = ?, next_run_at = ? WHERE id = ?', sc.active ? 0 : 1, sc.active ? sc.next_run_at : nextRunAt(sc.frequency), sc.id);
    return back(reply, path, 'ok', sc.active ? E.pausedMsg : E.resumedMsg);
  });

  app.post('/app/sites/:id/email-reports/:sid/delete', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const E = T(req, ctx).er;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send('Not found');
    const n = run('DELETE FROM report_schedules WHERE id = ? AND site_id = ?', (req.params as any).sid, s.id).changes;
    if (!n) return reply.code(404).send('Not found');
    return back(reply, `/app/sites/${s.id}/email-reports`, 'ok', E.deleted);
  });

  // ---- Unsubscribe (public; the HMAC token is the authorisation) ----
  app.get('/r/unsubscribe', async (req, reply) => {
    const q = (req.query ?? {}) as any, E = T(req).er;
    const sc = unsubOk(String(q.s ?? ''), String(q.e ?? ''), String(q.t ?? '')) ? get<any>('SELECT r.*, s.name AS site_name FROM report_schedules r JOIN sites s ON s.id = r.site_id WHERE r.id = ?', String(q.s)) : null;
    const on = sc && sc.recipients.split(',').includes(String(q.e).toLowerCase());
    reply.header('x-robots-tag', 'noindex');
    return reply.type('text/html').send(pg(req, { title: E.unsubTitle, body: html`<h1>${E.unsubTitle}</h1>
      ${on ? html`<p>${E.unsubText(sc.site_name, String(q.e))}</p><form method="post" action="/api/report-unsubscribe">
        <input type="hidden" name="s" value="${String(q.s)}"><input type="hidden" name="e" value="${String(q.e)}"><input type="hidden" name="t" value="${String(q.t)}">
        <button class="btn btn-primary" type="submit">${E.unsubBtn}</button></form>` : html`<p>${E.unsubInvalid}</p>`}` }));
  });
  // Form post and RFC 8058 one-click (List-Unsubscribe-Post) both land here.
  app.post('/api/report-unsubscribe', async (req, reply) => {
    const v = { ...((req.query ?? {}) as any), ...(typeof req.body === 'object' && req.body ? req.body as any : {}) }, E = T(req).er;
    const ok = unsubOk(String(v.s ?? ''), String(v.e ?? ''), String(v.t ?? '')) && unsubscribe(String(v.s), String(v.e));
    return reply.code(ok ? 200 : 400).type('text/html').send(pg(req, { title: E.unsubTitle, body: html`<h1>${E.unsubTitle}</h1><p>${ok ? E.unsubDone : E.unsubInvalid}</p>` }));
  });
}
