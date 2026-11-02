import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { all, get, run, now } from '../db.ts';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import { planOf } from '../lib/plans.ts';
import { t } from '../i18n.ts';
import { summary as manualSummary } from '../lib/manualReview.ts';
import { CLIENTS_PER_TEAM, NAME_MAX, NOTES_MAX, EMAIL, siteRows } from '../lib/clients.ts';
import { requireUser, render, back, ownSite, loc, T, localTime } from './guard.ts';

const ownClient = (teamId: string, id: string) => get<any>('SELECT * FROM clients WHERE id = ? AND team_id = ?', id, teamId);
function validate(body: any, C: any, teamId: string, selfId?: string): { err: string } | { name: string; contact: string | null; notes: string | null } {
  const name = String(body.name ?? '').trim().slice(0, NAME_MAX);
  if (!name) return { err: C.errName };
  const contact = String(body.contact_email ?? '').trim().toLowerCase();
  if (contact && !EMAIL.test(contact)) return { err: C.errContact };
  if (get('SELECT 1 FROM clients WHERE team_id = ? AND name = ? AND id IS NOT ?', teamId, name, selfId ?? null)) return { err: C.errDup };
  return { name, contact: contact || null, notes: String(body.notes ?? '').trim().slice(0, NOTES_MAX) || null };
}

export async function clientRoutes(app: FastifyInstance) {
  app.get('/app/clients', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const l = loc(req, ctx), C = t(l).cl;
    if (!planOf(ctx.team.plan).clients) return render(reply, ctx, { title: C.h, current: '/app/clients', body: html`<h1>${C.h}</h1><p class="notice">${C.gate} <a href="/app/billing">${t(l).layout.billing}</a></p><p>${C.gateKept}</p>` });
    const rows = all<any>(`SELECT c.*, COUNT(s.id) AS sites,
        COALESCE(SUM((SELECT critical+serious FROM scans WHERE site_id = s.id AND status='done' ORDER BY created_at DESC LIMIT 1)), 0) AS serious,
        MAX((SELECT finished_at FROM scans WHERE site_id = s.id AND status='done' ORDER BY created_at DESC LIMIT 1)) AS last_scan
      FROM clients c LEFT JOIN sites s ON s.client_id = c.id WHERE c.team_id = ? GROUP BY c.id ORDER BY c.name COLLATE NOCASE`, ctx.team.id);
    return render(reply, ctx, { title: C.h, current: '/app/clients', body: html`
      <p class="eyebrow">${ctx.team.name}</p><h1>${C.h}</h1><p>${C.lead}</p>
      ${rows.length ? html`<div class="table-wrap card" style="padding:8px 16px" tabindex="0" role="region" aria-labelledby="cl-cap"><table><caption id="cl-cap" class="sr-only">${C.h}</caption><thead><tr><th scope="col">${C.colClient}</th><th scope="col">${C.colSites}</th><th scope="col">${C.colSerious}</th><th scope="col">${C.colLast}</th><th scope="col">${C.colContact}</th></tr></thead><tbody>
        ${rows.map((c) => html`<tr><td><a href="/app/clients/${c.id}">${c.name}</a></td><td>${c.sites}</td><td>${c.sites ? c.serious : '–'}</td><td>${localTime(c.last_scan, l)}</td><td>${c.contact_email ?? '–'}</td></tr>`)}
      </tbody></table></div>` : html`<p>${C.none}</p>`}
      <h2 id="add-h">${C.addH}</h2>
      <form class="card" method="post" action="/app/clients" aria-labelledby="add-h">${csrfField(req)}
        <div class="grid g2"><div class="field"><label for="cl-name">${C.name}</label><input id="cl-name" name="name" type="text" required maxlength="${NAME_MAX}"></div>
        <div class="field"><label for="cl-contact">${C.contact}</label><input id="cl-contact" name="contact_email" type="email" autocomplete="off" aria-describedby="cl-contact-hint"><p id="cl-contact-hint" class="small muted">${C.contactHint}</p></div></div>
        <div class="field"><label for="cl-notes">${C.notes}</label><textarea id="cl-notes" name="notes" rows="2" maxlength="${NOTES_MAX}"></textarea></div>
        <button class="btn btn-primary" type="submit">${C.add}</button></form>` });
  });

  const gate = (req: any, reply: any) => {
    const ctx = requireUser(req, reply); if (!ctx) return null;
    const C = T(req, ctx).cl;
    if (!planOf(ctx.team.plan).clients) { back(reply, '/app/clients', 'err', C.gate); return null; }
    return { ctx, C };
  };

  app.post('/app/clients', async (req, reply) => {
    const g = gate(req, reply); if (!g) return; const { ctx, C } = g;
    if (get<any>('SELECT COUNT(*) AS n FROM clients WHERE team_id = ?', ctx.team.id).n >= CLIENTS_PER_TEAM) return back(reply, '/app/clients', 'err', C.errMax(CLIENTS_PER_TEAM));
    const v = validate(req.body ?? {}, C, ctx.team.id); if ('err' in v) return back(reply, '/app/clients', 'err', v.err);
    const id = randomUUID();
    run('INSERT INTO clients (id, team_id, name, contact_email, notes, created_at) VALUES (?,?,?,?,?,?)', id, ctx.team.id, v.name, v.contact, v.notes, now());
    return back(reply, `/app/clients/${id}`, 'ok', C.added);
  });

  app.get('/app/clients/:id', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const l = loc(req, ctx), Tx = t(l), C = Tx.cl;
    const c = ownClient(ctx.team.id, (req.params as any).id); if (!c) return render(reply, ctx, { title: Tx.dash.notFound, body: html`<h1>${Tx.dash.notFound}</h1>` }, 404);
    if (!planOf(ctx.team.plan).clients) return reply.redirect('/app/clients', 303);
    const sites = siteRows(ctx.team.id, c.id).map((s) => ({ ...s, m: s.verified_at ? manualSummary(s.id) : null }));
    const others = all<any>('SELECT s.id, s.name, s.origin, c.name AS client_name FROM sites s LEFT JOIN clients c ON c.id = s.client_id WHERE s.team_id = ? AND s.client_id IS NOT ? ORDER BY s.name COLLATE NOCASE', ctx.team.id, c.id);
    const serious = sites.reduce((n, s) => n + (s.last_serious ?? 0), 0);
    return render(reply, ctx, { title: `${c.name} – ${C.h}`, current: '/app/clients', body: html`
      <p><a href="/app/clients">${C.back}</a></p>
      <h1>${c.name}</h1><p class="muted">${C.stats(sites.length, serious)}${c.contact_email ? html` · ${c.contact_email}` : ''}</p>
      <section aria-labelledby="cs-h"><h2 id="cs-h">${C.sitesH}</h2>
      ${sites.length ? html`<div class="table-wrap card" style="padding:8px 16px" tabindex="0" role="region" aria-labelledby="cs-h"><table><thead><tr><th scope="col">${C.colSite}</th><th scope="col">${Tx.dash.colLast}</th><th scope="col">${Tx.dash.colSerious}</th><th scope="col">${C.colManual}</th><th scope="col">${C.colSchedules}</th><th scope="col">${Tx.dash.actions}</th></tr></thead><tbody>
        ${sites.map((s) => html`<tr><td><a href="/app/sites/${s.id}">${s.name}</a><br><span class="muted small">${s.origin}</span>${s.verified_at ? '' : html`<br><span class="pill imp-moderate">${Tx.dash.notVerified}</span>`}</td>
          <td>${localTime(s.last_scan, l)}</td><td>${s.last_serious ?? '–'}</td>
          <td>${s.m ? html`<a href="/app/sites/${s.id}/manual">${C.manualShort(s.m.pass, s.m.fail, s.m.not_checked)}</a>` : '–'}</td>
          <td>${s.verified_at ? html`<a href="/app/sites/${s.id}/email-reports">${C.activeN(s.schedules)}</a>` : '–'}</td>
          <td><form method="post" action="/app/clients/${c.id}/sites/${s.id}/remove">${csrfField(req)}<button class="btn btn-secondary" type="submit" aria-label="${C.removeFor(s.name)}">${C.remove}</button></form></td></tr>`)}
      </tbody></table></div>` : html`<p>${C.noSites}</p>`}
      </section>
      <section class="card" aria-labelledby="as-h" style="margin-top:24px"><h2 id="as-h" style="margin-top:0">${C.addSite}</h2>
      ${others.length ? html`<form method="post" action="/app/clients/${c.id}/sites">${csrfField(req)}
        <div class="field"><label for="as-site">${C.siteLabel}</label><select id="as-site" name="site_id">${others.map((s) => html`<option value="${s.id}">${s.name} (${s.origin})${s.client_name ? ` – ${C.inOther(s.client_name)}` : ''}</option>`)}</select></div>
        <button class="btn btn-primary" type="submit">${C.assign}</button></form>` : html`<p>${others.length === 0 && sites.length ? C.noFree : html`<a href="/app#name">${Tx.dash.addH}</a>`}</p>`}
      </section>
      <section class="card" aria-labelledby="ed-h" style="margin-top:24px"><h2 id="ed-h" style="margin-top:0">${C.editH}</h2>
        <form method="post" action="/app/clients/${c.id}">${csrfField(req)}
        <div class="grid g2"><div class="field"><label for="ed-name">${C.name}</label><input id="ed-name" name="name" type="text" required maxlength="${NAME_MAX}" value="${c.name}"></div>
        <div class="field"><label for="ed-contact">${C.contact}</label><input id="ed-contact" name="contact_email" type="email" autocomplete="off" value="${c.contact_email ?? ''}" aria-describedby="ed-contact-hint"><p id="ed-contact-hint" class="small muted">${C.contactHint}</p></div></div>
        <div class="field"><label for="ed-notes">${C.notes}</label><textarea id="ed-notes" name="notes" rows="3" maxlength="${NOTES_MAX}">${c.notes ?? ''}</textarea></div>
        <button class="btn btn-primary" type="submit">${C.save}</button></form>
      </section>
      <section class="card" aria-labelledby="del-h" style="margin-top:24px"><h2 id="del-h" style="margin-top:0">${C.delH}</h2><p>${C.delLead}</p>
        <form method="post" action="/app/clients/${c.id}/delete">${csrfField(req)}<button class="btn btn-secondary" type="submit">${C.del}</button></form></section>` });
  });

  const withClient = (req: any, reply: any) => {
    const g = gate(req, reply); if (!g) return null;
    const c = ownClient(g.ctx.team.id, req.params.id); if (!c) { reply.code(404).send('Not found'); return null; }
    return { ...g, c, path: `/app/clients/${c.id}` };
  };
  app.post('/app/clients/:id', async (req, reply) => {
    const g = withClient(req, reply); if (!g) return; const { ctx, C, c, path } = g;
    const v = validate(req.body ?? {}, C, ctx.team.id, c.id); if ('err' in v) return back(reply, path, 'err', v.err);
    run('UPDATE clients SET name = ?, contact_email = ?, notes = ? WHERE id = ?', v.name, v.contact, v.notes, c.id);
    return back(reply, path, 'ok', C.saved);
  });
  app.post('/app/clients/:id/sites', async (req, reply) => {
    const g = withClient(req, reply); if (!g) return; const { ctx, C, c, path } = g;
    const s = ownSite(ctx, String((req.body as any)?.site_id ?? '')); if (!s) return reply.code(404).send('Not found');
    run('UPDATE sites SET client_id = ? WHERE id = ?', c.id, s.id);
    return back(reply, path, 'ok', C.assigned);
  });
  app.post('/app/clients/:id/sites/:sid/remove', async (req, reply) => {
    const g = withClient(req, reply); if (!g) return; const { C, c, path } = g;
    const n = run('UPDATE sites SET client_id = NULL WHERE id = ? AND client_id = ? AND team_id = ?', (req.params as any).sid, c.id, c.team_id).changes;
    if (!n) return reply.code(404).send('Not found');
    return back(reply, path, 'ok', C.removed);
  });
  app.post('/app/clients/:id/delete', async (req, reply) => {
    const g = withClient(req, reply); if (!g) return; const { C, c } = g;
    run('DELETE FROM clients WHERE id = ?', c.id);
    return back(reply, '/app/clients', 'ok', C.deleted);
  });
  // Change a site's client from the site page.
  app.post('/app/sites/:id/client', async (req, reply) => {
    const g = gate(req, reply); if (!g) return; const { ctx, C } = g;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send('Not found');
    const cid = String((req.body as any)?.client_id ?? '');
    if (cid && !ownClient(ctx.team.id, cid)) return reply.code(404).send('Not found');
    run('UPDATE sites SET client_id = ? WHERE id = ?', cid || null, s.id);
    return back(reply, `/app/sites/${s.id}`, 'ok', C.siteSaved);
  });
}

/** Client card on the site page (Agency). */
export function siteClientCard(req: any, ctx: any, s: any) {
  if (!planOf(ctx.team.plan).clients) return html``;
  const C = T(req, ctx).cl, list = all<any>('SELECT id, name FROM clients WHERE team_id = ? ORDER BY name COLLATE NOCASE', ctx.team.id);
  const cur = list.find((c) => c.id === s.client_id);
  return html`<section class="card" aria-labelledby="sc-h" style="margin-bottom:24px"><h2 id="sc-h" style="margin-top:0">${C.siteCardH}</h2>
    <p>${cur ? html`<a href="/app/clients/${cur.id}">${cur.name}</a>` : C.siteNone}</p>
    ${list.length ? html`<form method="post" action="/app/sites/${s.id}/client" class="row" style="gap:12px;align-items:flex-end;flex-wrap:wrap">${csrfField(req)}
      <div class="field" style="margin:0"><label for="sc-sel">${C.siteSelect}</label><select id="sc-sel" name="client_id"><option value="">${C.siteNoneOpt}</option>${list.map((c) => html`<option value="${c.id}" ${c.id === s.client_id ? 'selected' : ''}>${c.name}</option>`)}</select></div>
      <button class="btn btn-secondary" type="submit">${C.siteSave}</button></form>` : html`<p class="small"><a href="/app/clients">${C.siteCreate}</a></p>`}</section>`;
}
