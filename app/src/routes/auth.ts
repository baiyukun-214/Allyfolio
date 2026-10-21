import type { FastifyInstance, FastifyRequest } from 'fastify';
import { get, run, now } from '../db.ts';
import { config } from '../config.ts';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import { mailer } from '../lib/mailer.ts';
import { validEmail } from '../lib/waitlist.ts';
import { rateLimiter } from '../lib/ratelimit.ts';
import { hashPassword, verifyPassword, createUserWithTeam, startSession, endSession, createLoginToken, consumeLoginToken, currentUser } from '../lib/auth.ts';
import { planOf, assertCanAddSeat, LimitError } from '../lib/plans.ts';
import { pg, loc, T } from './guard.ts';
import { LANG_COOKIE, normLocale, t } from '../i18n.ts';

const authLimit = rateLimiter(20, 15 * 60_000);
const field = (id: string, label: string, type: string, extra: any = '', hint = '') => html`<div class="field"><label for="${id}">${label}</label>${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}<input id="${id}" name="${id}" type="${type}" ${hint ? html`aria-describedby="${id}-hint"` : ''} ${extra}></div>`;

export function authForm(req: FastifyRequest, mode: 'login' | 'signup', error?: string, email = '') {
  const signup = mode === 'signup'; const A = T(req).auth;
  return pg(req, { title: signup ? A.signupTitle : A.loginTitle, flash: error ? { kind: 'error', msg: error } : null, body: html`
  <div class="narrow">
    <div class="card">
      <h1>${signup ? A.signupH : A.loginH}</h1>
      <p class="muted">${signup ? A.signupLead : A.loginLead}</p>
      <form method="post" action="/${mode}">${csrfField(req)}
        <div class="field"><label for="email">${A.email}</label><input id="email" name="email" type="email" autocomplete="email" required value="${email}"></div>
        ${field('password', A.password, 'password', html`autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="10"`, signup ? A.pwHint : '')}
        <button class="btn btn-primary" type="submit" style="width:100%">${signup ? A.signupTitle : A.loginTitle}</button>
      </form>
    </div>
    <div class="card" style="margin-top:16px">
      <h2 style="margin-top:0">${A.magicH}</h2>
      <form method="post" action="/login/link">${csrfField(req)}
        <div class="field"><label for="link-email">${A.magicEmail}</label><input id="link-email" name="email" type="email" autocomplete="email" required></div>
        <button class="btn btn-secondary" type="submit">${A.magicBtn}</button>
      </form>
    </div>
    <p class="small muted" style="margin-top:16px">${signup ? html`${A.have} <a href="/login">${A.haveLink}</a>` : html`${A.newHere} <a href="/signup">${A.newLink}</a>`}</p>
  </div>` });
}
const newUser = (req: FastifyRequest, email: string, hash: string | null) => {
  const l = loc(req); return createUserWithTeam(email, hash, '', l, t(l).auth.teamName(email.split('@')[0]));
};
const safeNext = (n: unknown) => { const s = String(n ?? ''); return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : '/app'; };

export async function authRoutes(app: FastifyInstance) {
  app.get('/login', async (req, reply) => { if (currentUser(req)) return reply.redirect('/app'); reply.type('text/html'); return authForm(req, 'login'); });
  app.get('/signup', async (req, reply) => { reply.type('text/html'); return authForm(req, 'signup'); });

  /** Language switcher: persist to cookie (and to the user's setting when logged in), then go back. */
  app.get('/lang', async (req, reply) => {
    const q = req.query as any; const l = normLocale(q.to) ?? 'en';
    reply.setCookie(LANG_COOKIE, l, { path: '/', maxAge: 31536000, sameSite: 'lax', httpOnly: false, secure: config.appUrl.startsWith('https') });
    const ctx = currentUser(req); if (ctx) run('UPDATE users SET locale = ? WHERE id = ?', l, ctx.user.id);
    return reply.redirect(safeNext(q.next), 303);
  });

  app.post('/signup', async (req, reply) => {
    const { email: e, password } = req.body as any; const email = String(e ?? '').trim().toLowerCase(); const A = T(req).auth;
    reply.type('text/html');
    if (!authLimit.take(req.ip).ok) return reply.code(429).send(authForm(req, 'signup', A.tooMany, email));
    if (!validEmail(email)) return reply.code(400).send(authForm(req, 'signup', T(req).errors.email, email));
    if (String(password ?? '').length < 10) return reply.code(400).send(authForm(req, 'signup', A.pwShort, email));
    if (get('SELECT 1 FROM users WHERE email = ?', email)) return reply.code(400).send(authForm(req, 'signup', A.exists, email));
    const { uid } = newUser(req, email, await hashPassword(password));
    startSession(reply, uid);
    return reply.redirect('/app', 303);
  });

  app.post('/login', async (req, reply) => {
    const { email: e, password } = req.body as any; const email = String(e ?? '').trim().toLowerCase(); const A = T(req).auth;
    reply.type('text/html');
    if (!authLimit.take(req.ip).ok) return reply.code(429).send(authForm(req, 'login', A.tooMany, email));
    const u = get<any>('SELECT * FROM users WHERE email = ?', email);
    if (!u || !(await verifyPassword(String(password ?? ''), u.password_hash))) return reply.code(400).send(authForm(req, 'login', A.wrong, email));
    startSession(reply, u.id);
    return reply.redirect('/app', 303);
  });

  app.post('/login/link', async (req, reply) => {
    const email = String((req.body as any).email ?? '').trim().toLowerCase();
    const known = get<any>('SELECT locale FROM users WHERE email = ?', email);
    const A = t(known?.locale ?? loc(req)).auth;
    reply.type('text/html');
    if (authLimit.take(req.ip).ok && validEmail(email)) {
      const token = createLoginToken(email);
      await mailer.send({ to: email, subject: A.mailSubject, text: A.mailBody(`${config.appUrl}/login/callback?token=${token}`) });
    }
    const P = T(req).auth;
    return pg(req, { title: P.checkTitle, body: html`<div class="narrow card"><h1>${P.checkTitle}</h1><p>${P.checkBody}</p></div>` });
  });

  app.get('/login/callback', async (req, reply) => {
    const email = consumeLoginToken((req.query as any).token);
    if (!email) { reply.type('text/html'); return reply.code(400).send(authForm(req, 'login', T(req).auth.linkInvalid)); }
    let u = get<any>('SELECT id FROM users WHERE email = ?', email);
    if (!u) u = { id: newUser(req, email, null).uid };
    run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', now(), u.id);
    startSession(reply, u.id);
    return reply.redirect('/app', 303);
  });

  app.post('/logout', async (req, reply) => { endSession(req, reply); return reply.redirect('/login', 303); });

  app.get('/invite/:token', async (req, reply) => {
    const inv = get<any>('SELECT i.*, t.name AS team_name, t.plan FROM invites i JOIN teams t ON t.id = i.team_id WHERE i.token = ? AND i.accepted_at IS NULL', (req.params as any).token);
    reply.type('text/html');
    const ctx = currentUser(req); const A = T(req, ctx).auth;
    if (!inv) return reply.code(404).send(pg(req, { title: A.inviteNotFound, body: html`<div class="narrow card"><h1>${A.inviteNotFound}</h1><p>${A.inviteUsed}</p></div>` }, ctx));
    if (!ctx) return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
    const seats = get<any>('SELECT COUNT(*) AS n FROM memberships WHERE team_id = ?', inv.team_id)!.n;
    try { assertCanAddSeat(planOf(inv.plan), seats); } catch (e) { if (e instanceof LimitError) return reply.code(403).send(pg(req, { title: A.noSeat, user: ctx.user, body: html`<div class="narrow card"><h1>${A.noSeat}</h1><p>${e.msg(loc(req, ctx))} ${A.askOwner}</p></div>` }, ctx)); throw e; }
    run('DELETE FROM memberships WHERE user_id = ? AND role = ? AND NOT EXISTS (SELECT 1 FROM sites WHERE team_id = memberships.team_id)', ctx.user.id, 'owner');
    run("INSERT OR IGNORE INTO memberships (team_id, user_id, role, created_at) VALUES (?,?,'member',?)", inv.team_id, ctx.user.id, now());
    run('UPDATE invites SET accepted_at = ? WHERE token = ?', now(), inv.token);
    return reply.redirect('/app', 303);
  });
}
