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
import { requireUser, render, back, ownSite } from './guard.ts';
import { siteDetailExtras } from './monitoring.ts';

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '–';

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/app', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const plan = planOf(ctx.team.plan);
    const sites = all<any>(`SELECT s.*, (SELECT finished_at FROM scans WHERE site_id = s.id AND status='done' ORDER BY created_at DESC LIMIT 1) AS last_scan,
      (SELECT critical+serious FROM scans WHERE site_id = s.id AND status='done' ORDER BY created_at DESC LIMIT 1) AS last_serious FROM sites s WHERE team_id = ? ORDER BY created_at`, ctx.team.id);
    return render(reply, ctx, { title: 'Sites', current: '/app', body: html`
      <div class="row between"><div><p class="eyebrow">${ctx.team.name}</p><h1>Sites</h1></div><span class="pill">${plan.name} plan · ${sites.length}/${plan.sites} site${plan.sites === 1 ? '' : 's'}</span></div>
      ${ctx.team.plan === 'none' ? html`<p class="notice"><strong>No plan yet.</strong> Add and verify a site, then <a href="/app/billing">choose a plan</a> for scheduled scans, or buy a one-off report.</p>` : ''}
      ${sites.length ? html`<div class="table-wrap card" style="padding:8px 16px"><table><caption class="sr-only">Your sites</caption><thead><tr><th scope="col">Site</th><th scope="col">Ownership</th><th scope="col">Last scan</th><th scope="col">Critical + serious</th></tr></thead><tbody>
        ${sites.map((s) => html`<tr><td><a href="/app/sites/${s.id}">${s.name}</a><br><span class="muted small">${s.origin}</span></td><td>${s.verified_at ? html`<span class="pill ok">Verified</span>` : html`<span class="pill imp-moderate">Not verified</span>`}</td><td>${fmt(s.last_scan)}</td><td>${s.last_serious ?? '–'}</td></tr>`)}
      </tbody></table></div>` : html`<p class="muted">No sites yet.</p>`}
      <h2>Add a site</h2>
      <form class="card" method="post" action="/app/sites">${csrfField(req)}
        <div class="grid g2"><div class="field"><label for="name">Name</label><input id="name" name="name" type="text" required maxlength="80" placeholder="Main shop"></div>
        <div class="field"><label for="origin">Website address</label><input id="origin" name="origin" type="url" required placeholder="https://www.example.com"></div></div>
        <button class="btn btn-primary" type="submit">Add site</button>
      </form>` });
  });

  app.post('/app/sites', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const { name, origin } = req.body as any;
    let o: string;
    try { o = parsePublicUrl(origin).origin; } catch (e) { return back(reply, '/app', 'err', e instanceof UnsafeUrlError ? e.message : 'Invalid address.'); }
    const count = get<any>('SELECT COUNT(*) AS n FROM sites WHERE team_id = ?', ctx.team.id)!.n;
    try { assertCanAddSite(planOf(ctx.team.plan), count); } catch (e) { if (e instanceof LimitError) return back(reply, '/app', 'err', e.message); throw e; }
    if (get('SELECT 1 FROM sites WHERE team_id = ? AND origin = ?', ctx.team.id, o)) return back(reply, '/app', 'err', 'This site is already in your list.');
    const id = randomUUID();
    run('INSERT INTO sites (id, team_id, name, origin, verify_token, created_at) VALUES (?,?,?,?,?,?)', id, ctx.team.id, String(name || o).slice(0, 80), o, randomBytes(16).toString('hex'), now());
    return reply.redirect(`/app/sites/${id}`, 303);
  });

  app.get('/app/sites/:id', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return render(reply, ctx, { title: 'Not found', body: html`<h1>Site not found</h1>` }, 404);
    return render(reply, ctx, { title: s.name, current: '/app', body: html`
      <p><a href="/app">← All sites</a></p>
      <div class="row between"><div><h1>${s.name}</h1><p class="muted">${s.origin}</p></div>
      ${s.verified_at ? html`<span class="pill ok">Ownership verified (${s.verify_method === 'dns' ? 'DNS' : 'meta tag'})</span>` : html`<span class="pill imp-moderate">Not verified</span>`}</div>
      ${s.verified_at ? siteDetailExtras(req, ctx, s) : html`
        <section class="card" aria-labelledby="verify-h"><h2 id="verify-h" style="margin-top:0">Verify that you own this site</h2>
          <p>We only scan sites you control. Use <strong>one</strong> of these methods, then select “Check now”.</p>
          <h3>Option 1: DNS TXT record</h3><p class="small">Add a TXT record to <code>${new URL(s.origin).hostname}</code>:</p><p><code>${TXT_PREFIX}${s.verify_token}</code></p>
          <h3>Option 2: meta tag</h3><p class="small">Add this to the <code>&lt;head&gt;</code> of your home page:</p><p><code>&lt;meta name="${META_NAME}" content="${s.verify_token}"&gt;</code></p>
          <form method="post" action="/app/sites/${s.id}/verify">${csrfField(req)}<button class="btn btn-primary" type="submit">Check now</button></form>
        </section>`}
      <h2>Danger zone</h2>
      <form method="post" action="/app/sites/${s.id}/delete">${csrfField(req)}<button class="btn btn-danger" type="submit">Remove site and its scan history</button></form>` });
  });

  app.post('/app/sites/:id/verify', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const s = ownSite(ctx, (req.params as any).id); if (!s) return reply.code(404).send();
    const method = await verifySite(s.origin, s.verify_token);
    if (!method) return back(reply, `/app/sites/${s.id}`, 'err', 'We could not find the TXT record or meta tag yet. DNS changes can take a while – try again later.');
    run('UPDATE sites SET verified_at = ?, verify_method = ? WHERE id = ?', now(), method, s.id);
    const { scheduleFirstScan } = await import('../jobs/queue.ts');
    scheduleFirstScan(s.id, ctx.team);
    return back(reply, `/app/sites/${s.id}`, 'ok', 'Ownership verified.');
  });

  app.post('/app/sites/:id/delete', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    if (ctx.role !== 'owner') return back(reply, `/app/sites/${(req.params as any).id}`, 'err', 'Only the team owner can remove sites.');
    run('DELETE FROM sites WHERE id = ? AND team_id = ?', (req.params as any).id, ctx.team.id);
    return back(reply, '/app', 'ok', 'Site removed.');
  });

  app.get('/app/team', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const plan = planOf(ctx.team.plan);
    const members = all<any>('SELECT u.email, u.id, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.created_at', ctx.team.id);
    const invites = all<any>('SELECT * FROM invites WHERE team_id = ? AND accepted_at IS NULL', ctx.team.id);
    return render(reply, ctx, { title: 'Team', current: '/app/team', body: html`
      <div class="row between"><h1>Team</h1><span class="pill">${members.length}/${plan.seats} seat${plan.seats === 1 ? '' : 's'} used</span></div>
      <div class="card table-wrap"><table><caption class="sr-only">Team members</caption><thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${members.map((m) => html`<tr><td>${m.email}</td><td>${m.role}</td><td>${ctx.role === 'owner' && m.id !== ctx.user.id ? html`<form method="post" action="/app/team/remove">${csrfField(req)}<input type="hidden" name="user_id" value="${m.id}"><button class="btn btn-danger" type="submit">Remove<span class="sr-only"> ${m.email}</span></button></form>` : ''}</td></tr>`)}
      ${invites.map((i) => html`<tr><td>${i.email}</td><td>Invited</td><td></td></tr>`)}
      </tbody></table></div>
      ${ctx.role === 'owner' ? html`<h2>Invite someone</h2><form class="card" method="post" action="/app/team/invite">${csrfField(req)}
        <div class="field"><label for="invite-email">Email</label><input id="invite-email" name="email" type="email" required></div>
        <button class="btn btn-primary" type="submit">Send invite</button></form>` : ''}
      ${ctx.role === 'owner' && plan.whiteLabel ? html`<h2>Report branding</h2><form class="card" method="post" action="/app/team/branding">${csrfField(req)}
        <div class="grid g3"><div class="field"><label for="brand_name">Agency name</label><input id="brand_name" name="brand_name" type="text" maxlength="80" value="${ctx.team.brand_name ?? ''}"></div>
        <div class="field"><label for="brand_color">Brand colour</label><p class="hint" id="bc-hint">Hex, e.g. #1E3A8A. Must have 4.5:1 contrast on white.</p><input id="brand_color" name="brand_color" type="text" aria-describedby="bc-hint" pattern="#[0-9a-fA-F]{6}" value="${ctx.team.brand_color ?? ''}"></div>
        <div class="field"><label for="brand_logo_url">Logo URL (https)</label><input id="brand_logo_url" name="brand_logo_url" type="url" value="${ctx.team.brand_logo_url ?? ''}"></div></div>
        <button class="btn btn-primary" type="submit">Save branding</button></form>` : ''}` });
  });

  app.post('/app/team/invite', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    if (ctx.role !== 'owner') return back(reply, '/app/team', 'err', 'Only the team owner can invite people.');
    const email = String((req.body as any).email ?? '').trim().toLowerCase();
    if (!validEmail(email)) return back(reply, '/app/team', 'err', 'Please enter a valid email address.');
    const used = get<any>('SELECT (SELECT COUNT(*) FROM memberships WHERE team_id = ?) + (SELECT COUNT(*) FROM invites WHERE team_id = ? AND accepted_at IS NULL) AS n', ctx.team.id, ctx.team.id)!.n;
    try { assertCanAddSeat(planOf(ctx.team.plan), used); } catch (e) { if (e instanceof LimitError) return back(reply, '/app/team', 'err', e.message); throw e; }
    const token = randomBytes(24).toString('base64url');
    run('INSERT INTO invites (token, team_id, email, created_at) VALUES (?,?,?,?)', token, ctx.team.id, email, now());
    await mailer.send({ to: email, subject: `You are invited to ${ctx.team.name} on Allyfolio`, text: `${ctx.user.email} invited you to join ${ctx.team.name} on Allyfolio:\n${config.appUrl}/invite/${token}` });
    return back(reply, '/app/team', 'ok', `Invite sent to ${email}.`);
  });

  app.post('/app/team/remove', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    if (ctx.role !== 'owner') return back(reply, '/app/team', 'err', 'Only the team owner can remove people.');
    run("DELETE FROM memberships WHERE team_id = ? AND user_id = ? AND role != 'owner'", ctx.team.id, (req.body as any).user_id);
    return back(reply, '/app/team', 'ok', 'Member removed.');
  });
}
