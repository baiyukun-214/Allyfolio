import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { all, get, run, now } from '../db.ts';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import { parsePublicUrl, UnsafeUrlError } from '../lib/ssrf.ts';
import { planOf, assertCanAddSite, assertCanAddSeat, LimitError } from '../lib/plans.ts';
import { verifySite, TXT_PREFIX, META_NAME } from '../lib/verify.ts';
import { mailer } from '../lib/mailer.ts';
import { validEmail } from '../lib/waitlist.ts';
import { config } from '../config.ts';
import { requireUser, render, back, ownSite, T, loc, fmtDate } from './guard.ts';
import { LOCALES, normLocale, t, trError } from '../i18n.ts';
import { siteDetailExtras } from './monitoring.ts';
import { accountSection } from './account.ts';
import { emptyState } from '../views/ui.ts';


export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/app', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const plan = planOf(ctx.team.plan);
    const sites = all<any>(`SELECT s.*, (SELECT finished_at FROM scans WHERE site_id = s.id AND status='done' ORDER BY created_at DESC LIMIT 1) AS last_scan,
      (SELECT critical+serious FROM scans WHERE site_id = s.id AND status='done' ORDER BY created_at DESC LIMIT 1) AS last_serious FROM sites s WHERE team_id = ? ORDER BY created_at`, ctx.team.id);
    const l = loc(req, ctx), Tx = t(l), D = Tx.dash;
    return render(reply, ctx, { title: D.sites, current: '/app', body: html`
      <div class="row between"><div><p class="eyebrow">${ctx.team.name}</p><h1>${D.sites}</h1></div><span class="pill">${D.planPill(Tx.plans[plan.id] ?? plan.name, sites.length, plan.sites)}</span></div>
      ${ctx.team.plan === 'none' ? html`<p class="notice"><strong>${D.noPlanH}</strong> ${D.noPlan} <a href="/app/billing">${D.noPlanLink}</a>${D.noPlanEnd}</p>` : ''}
      ${sites.length ? html`<div class="table-wrap card" style="padding:8px 16px"><table><caption class="sr-only">${D.yourSites}</caption><thead><tr><th scope="col">${D.colSite}</th><th scope="col">${D.colOwner}</th><th scope="col">${D.colLast}</th><th scope="col">${D.colSerious}</th></tr></thead><tbody>
        ${sites.map((s) => html`<tr><td><a href="/app/sites/${s.id}">${s.name}</a><br><span class="muted small">${s.origin}</span></td><td>${s.verified_at ? html`<span class="pill ok">${D.verified}</span>` : html`<span class="pill imp-moderate">${D.notVerified}</span>`}</td><td>${fmtDate(s.last_scan, l)}</td><td>${s.last_serious ?? '–'}</td></tr>`)}
      </tbody></table></div>` : emptyState(D.emptySitesH, D.emptySitesText, html`<a class="btn btn-primary" href="#name">${D.addH}</a>`)}
      <h2>${D.addH}</h2>
      <form class="card" method="post" action="/app/sites">${csrfField(req)}
        <div class="grid g2"><div class="field"><label for="name">${D.name}</label><input id="name" name="name" type="text" required maxlength="80" placeholder="${D.namePh}"></div>
        <div class="field"><label for="origin">${D.origin}</label><input id="origin" name="origin" type="url" required placeholder="https://www.example.com"></div></div>
        <button class="btn btn-primary" type="submit">${D.addBtn}</button>
      </form>` });
  });

  app.post('/app/sites', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const { name, origin } = req.body as any; const l = loc(req, ctx), D = t(l).dash;
    let o: string;
    try { o = parsePublicUrl(origin).origin; } catch (e) { return back(reply, '/app', 'err', e instanceof UnsafeUrlError ? trError(l, e.message) : D.invalidAddr); }
    const count = get<any>('SELECT COUNT(*) AS n FROM sites WHERE team_id = ?', ctx.team.id)!.n;
    try { assertCanAddSite(planOf(ctx.team.plan), count); } catch (e) { if (e instanceof LimitError) return back(reply, '/app', 'err', e.msg(l)); throw e; }
    if (get('SELECT 1 FROM sites WHERE team_id = ? AND origin = ?', ctx.team.id, o)) return back(reply, '/app', 'err', D.dup);
    const id = randomUUID();
    run('INSERT INTO sites (id, team_id, name, origin, verify_token, created_at) VALUES (?,?,?,?,?,?)', id, ctx.team.id, String(name || o).slice(0, 80), o, randomBytes(16).toString('hex'), now());
    return reply.redirect(`/app/sites/${id}`, 303);
  });

  app.get('/app/sites/:id', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const D = T(req, ctx).dash;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return render(reply, ctx, { title: D.notFound, body: html`<h1>${D.notFound}</h1>` }, 404);
    return render(reply, ctx, { title: s.name, current: '/app', body: html`
      <p><a href="/app">${D.back}</a></p>
      <div class="row between"><div><h1>${s.name}</h1><p class="muted">${s.origin}</p></div>
      ${s.verified_at ? html`<span class="pill ok">${D.verifiedVia(s.verify_method)}</span>` : html`<span class="pill imp-moderate">${D.notVerified}</span>`}</div>
      ${s.verified_at ? siteDetailExtras(req, ctx, s) : html`
        <section class="card" aria-labelledby="verify-h"><h2 id="verify-h" style="margin-top:0">${D.verifyH}</h2>
          <p>${D.verifyLead}</p>
          <h3>${D.opt1}</h3><p class="small">${D.opt1Text} <code>${new URL(s.origin).hostname}</code>:</p><p><code>${TXT_PREFIX}${s.verify_token}</code></p>
          <h3>${D.opt2}</h3><p class="small">${D.opt2Text}</p><p><code>&lt;meta name="${META_NAME}" content="${s.verify_token}"&gt;</code></p>
          <form method="post" action="/app/sites/${s.id}/verify">${csrfField(req)}<button class="btn btn-primary" type="submit">${D.checkNow}</button></form>
        </section>`}
` });
  });

  app.post('/app/sites/:id/verify', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send();
    const method = await verifySite(s.origin, s.verify_token);
    if (!method) return back(reply, `/app/sites/${s.id}`, 'err', T(req, ctx).dash.verifyFail);
    run('UPDATE sites SET verified_at = ?, verify_method = ? WHERE id = ?', now(), method, s.id);
    const { scheduleFirstScan } = await import('../jobs/queue.ts');
    scheduleFirstScan(s.id, ctx.team);
    return back(reply, `/app/sites/${s.id}`, 'ok', T(req, ctx).dash.verifyOk);
  });

  app.post('/app/sites/:id/delete', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    if (ctx.role !== 'owner') return back(reply, `/app/sites/${(req.params as any).id}`, 'err', T(req, ctx).dash.ownerOnlyRemove);
    run('DELETE FROM sites WHERE id = ? AND team_id = ?', (req.params as any).id, ctx.team.id);
    return back(reply, '/app', 'ok', T(req, ctx).dash.removed);
  });

  app.get('/app/team', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const plan = planOf(ctx.team.plan);
    const members = all<any>('SELECT u.email, u.id, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.created_at', ctx.team.id);
    const invites = all<any>('SELECT * FROM invites WHERE team_id = ? AND accepted_at IS NULL', ctx.team.id);
    const D = T(req, ctx).dash;
    return render(reply, ctx, { title: D.team, current: '/app/team', body: html`
      <div class="row between"><h1>${D.team}</h1><span class="pill">${D.seatsUsed(members.length, plan.seats)}</span></div>
      <div class="card table-wrap"><table><caption class="sr-only">${D.members}</caption><thead><tr><th scope="col">${D.colEmail}</th><th scope="col">${D.colRole}</th><th scope="col"><span class="sr-only">${D.actions}</span></th></tr></thead><tbody>
      ${members.map((m) => html`<tr><td>${m.email}</td><td>${D.roles[m.role] ?? m.role}</td><td>${ctx.role === 'owner' && m.id !== ctx.user.id ? html`<form method="post" action="/app/team/remove">${csrfField(req)}<input type="hidden" name="user_id" value="${m.id}"><button class="btn btn-danger" type="submit">${D.removeBtn}<span class="sr-only"> ${m.email}</span></button></form>` : ''}</td></tr>`)}
      ${invites.map((i) => html`<tr><td>${i.email}</td><td>${D.invited}</td><td></td></tr>`)}
      </tbody></table></div>
      ${ctx.role === 'owner' ? html`<h2>${D.inviteH}</h2><form class="card" method="post" action="/app/team/invite">${csrfField(req)}
        <div class="field"><label for="invite-email">${D.colEmail}</label><input id="invite-email" name="email" type="email" required></div>
        <button class="btn btn-primary" type="submit">${D.inviteBtn}</button></form>` : ''}
      ${ctx.role === 'owner' && plan.whiteLabel ? html`<h2>${D.brandH}</h2><form class="card" method="post" action="/app/team/branding">${csrfField(req)}
        <div class="grid g3"><div class="field"><label for="brand_name">${D.brandName}</label><input id="brand_name" name="brand_name" type="text" maxlength="80" value="${ctx.team.brand_name ?? ''}"></div>
        <div class="field"><label for="brand_color">${D.brandColor}</label><p class="hint" id="bc-hint">${D.brandColorHint}</p><input id="brand_color" name="brand_color" type="text" aria-describedby="bc-hint" pattern="#[0-9a-fA-F]{6}" value="${ctx.team.brand_color ?? ''}"></div>
        <div class="field"><label for="brand_logo_url">${D.brandLogo}</label><input id="brand_logo_url" name="brand_logo_url" type="url" value="${ctx.team.brand_logo_url ?? ''}"></div></div>
        <button class="btn btn-primary" type="submit">${D.brandSave}</button></form>` : ''}` });
  });

  app.post('/app/team/invite', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const l = loc(req, ctx), D = t(l).dash;
    if (ctx.role !== 'owner') return back(reply, '/app/team', 'err', D.ownerOnlyInvite);
    const email = String((req.body as any).email ?? '').trim().toLowerCase();
    if (!validEmail(email)) return back(reply, '/app/team', 'err', t(l).errors.email);
    const used = get<any>('SELECT (SELECT COUNT(*) FROM memberships WHERE team_id = ?) + (SELECT COUNT(*) FROM invites WHERE team_id = ? AND accepted_at IS NULL) AS n', ctx.team.id, ctx.team.id)!.n;
    try { assertCanAddSeat(planOf(ctx.team.plan), used); } catch (e) { if (e instanceof LimitError) return back(reply, '/app/team', 'err', e.msg(l)); throw e; }
    const token = randomBytes(24).toString('base64url');
    run('INSERT INTO invites (token, team_id, email, created_at) VALUES (?,?,?,?)', token, ctx.team.id, email, now());
    await mailer.send({ to: email, subject: D.inviteSubject(ctx.team.name), text: D.inviteBody(ctx.user.email, ctx.team.name, `${config.appUrl}/invite/${token}`) });
    return back(reply, '/app/team', 'ok', D.inviteSent(email));
  });

  app.post('/app/team/remove', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    if (ctx.role !== 'owner') return back(reply, '/app/team', 'err', T(req, ctx).dash.ownerOnlyRemoveM);
    run("DELETE FROM memberships WHERE team_id = ? AND user_id = ? AND role != 'owner'", ctx.team.id, (req.body as any).user_id);
    return back(reply, '/app/team', 'ok', T(req, ctx).dash.memberRemoved);
  });

  app.get('/app/settings', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const l = loc(req, ctx), D = t(l).dash;
    const sites = all<any>('SELECT id, name, origin FROM sites WHERE team_id = ? ORDER BY created_at', ctx.team.id);
    return render(reply, ctx, { title: D.settings, current: '/app/settings', body: html`
      <h1>${D.settings}</h1>
      <form class="card narrow" style="margin:0" method="post" action="/app/settings">${csrfField(req)}
        <div class="field"><label for="locale">${D.language}</label><p class="hint" id="locale-hint">${D.languageHint}</p>
          <select id="locale" name="locale" aria-describedby="locale-hint">${LOCALES.map((x) => html`<option value="${x}" lang="${x}" ${x === l ? html`selected` : ''}>${t(x).langName}</option>`)}</select></div>
        <button class="btn btn-primary" type="submit">${D.save}</button>
      </form>
      ${accountSection(req, ctx)}
      ${ctx.role === 'owner' && sites.length ? html`<section class="card danger-zone" aria-labelledby="danger-h"><h2 id="danger-h" style="margin-top:0">${D.danger}</h2><p class="muted small">${D.dangerLead}</p>
        <ul class="danger-list">${sites.map((x) => html`<li><span><strong>${x.name}</strong> <span class="muted small">${x.origin}</span></span><form method="post" action="/app/sites/${x.id}/delete">${csrfField(req)}<button class="btn btn-danger" type="submit">${D.remove}<span class="sr-only"> – ${x.name}</span></button></form></li>`)}</ul></section>` : ''}` });
  });

  app.post('/app/settings', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const l = normLocale((req.body as any).locale) ?? 'en';
    run('UPDATE users SET locale = ? WHERE id = ?', l, ctx.user.id);
    reply.setCookie('af_lang', l, { path: '/', maxAge: 31536000, sameSite: 'lax', secure: config.appUrl.startsWith('https') });
    return back(reply, '/app/settings', 'ok', t(l).dash.saved);
  });
}
