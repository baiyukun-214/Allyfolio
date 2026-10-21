import type { FastifyInstance, FastifyRequest } from 'fastify';
import { get, run, now } from '../db.ts';
import { config } from '../config.ts';
import { html } from '../lib/html.ts';
import { page } from '../views/layout.ts';
import { csrfField } from '../lib/csrf.ts';
import { mailer } from '../lib/mailer.ts';
import { validEmail } from '../lib/waitlist.ts';
import { rateLimiter } from '../lib/ratelimit.ts';
import { hashPassword, verifyPassword, createUserWithTeam, startSession, endSession, createLoginToken, consumeLoginToken, currentUser } from '../lib/auth.ts';
import { planOf, assertCanAddSeat, LimitError } from '../lib/plans.ts';

const authLimit = rateLimiter(20, 15 * 60_000);
const field = (id: string, label: string, type: string, extra: any = '', hint = '') => html`<div class="field"><label for="${id}">${label}</label>${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}<input id="${id}" name="${id}" type="${type}" ${hint ? html`aria-describedby="${id}-hint"` : ''} ${extra}></div>`;

export function authForm(req: FastifyRequest, mode: 'login' | 'signup', error?: string, email = '') {
  const signup = mode === 'signup';
  return page({ title: signup ? 'Create account' : 'Log in', flash: error ? { kind: 'error', msg: error } : null, body: html`
  <div class="narrow">
    <div class="card">
      <h1>${signup ? 'Create your account' : 'Log in'}</h1>
      <p class="muted">${signup ? 'Monitor your sites and keep a timestamped evidence trail.' : 'Welcome back.'}</p>
      <form method="post" action="/${mode}">${csrfField(req)}
        <div class="field"><label for="email">Work email</label><input id="email" name="email" type="email" autocomplete="email" required value="${email}"></div>
        ${field('password', 'Password', 'password', html`autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="10"`, signup ? 'At least 10 characters.' : '')}
        <button class="btn btn-primary" type="submit" style="width:100%">${signup ? 'Create account' : 'Log in'}</button>
      </form>
    </div>
    <div class="card" style="margin-top:16px">
      <h2 style="margin-top:0">Prefer a magic link?</h2>
      <form method="post" action="/login/link">${csrfField(req)}
        <div class="field"><label for="link-email">Email</label><input id="link-email" name="email" type="email" autocomplete="email" required></div>
        <button class="btn btn-secondary" type="submit">Email me a sign-in link</button>
      </form>
    </div>
    <p class="small muted" style="margin-top:16px">${signup ? html`Already have an account? <a href="/login">Log in</a>` : html`New here? <a href="/signup">Create an account</a>`}</p>
  </div>` });
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/login', async (req, reply) => { if (currentUser(req)) return reply.redirect('/app'); reply.type('text/html'); return authForm(req, 'login'); });
  app.get('/signup', async (req, reply) => { reply.type('text/html'); return authForm(req, 'signup'); });

  app.post('/signup', async (req, reply) => {
    const { email: e, password } = req.body as any; const email = String(e ?? '').trim().toLowerCase();
    reply.type('text/html');
    if (!authLimit.take(req.ip).ok) return reply.code(429).send(authForm(req, 'signup', 'Too many attempts. Please wait a few minutes.', email));
    if (!validEmail(email)) return reply.code(400).send(authForm(req, 'signup', 'Please enter a valid email address.', email));
    if (String(password ?? '').length < 10) return reply.code(400).send(authForm(req, 'signup', 'Your password needs at least 10 characters.', email));
    if (get('SELECT 1 FROM users WHERE email = ?', email)) return reply.code(400).send(authForm(req, 'signup', 'An account with this email already exists. Log in or use a magic link.', email));
    const { uid } = createUserWithTeam(email, await hashPassword(password));
    startSession(reply, uid);
    return reply.redirect('/app', 303);
  });

  app.post('/login', async (req, reply) => {
    const { email: e, password } = req.body as any; const email = String(e ?? '').trim().toLowerCase();
    reply.type('text/html');
    if (!authLimit.take(req.ip).ok) return reply.code(429).send(authForm(req, 'login', 'Too many attempts. Please wait a few minutes.', email));
    const u = get<any>('SELECT * FROM users WHERE email = ?', email);
    if (!u || !(await verifyPassword(String(password ?? ''), u.password_hash))) return reply.code(400).send(authForm(req, 'login', 'Email or password is not correct.', email));
    startSession(reply, u.id);
    return reply.redirect('/app', 303);
  });

  app.post('/login/link', async (req, reply) => {
    const email = String((req.body as any).email ?? '').trim().toLowerCase();
    reply.type('text/html');
    if (authLimit.take(req.ip).ok && validEmail(email)) {
      const token = createLoginToken(email);
      await mailer.send({ to: email, subject: 'Your Allyfolio sign-in link', text: `Sign in to Allyfolio (link valid for 15 minutes, one use):\n${config.appUrl}/login/callback?token=${token}\n\nIf you did not request this, ignore this email.` });
    }
    return page({ title: 'Check your email', body: html`<div class="narrow card"><h1>Check your email</h1><p>If the address is valid, we sent a sign-in link to it. The link works once and expires in 15 minutes.</p></div>` });
  });

  app.get('/login/callback', async (req, reply) => {
    const email = consumeLoginToken((req.query as any).token);
    if (!email) { reply.type('text/html'); return reply.code(400).send(authForm(req, 'login', 'That sign-in link is invalid or has expired.')); }
    let u = get<any>('SELECT id FROM users WHERE email = ?', email);
    if (!u) u = { id: createUserWithTeam(email, null).uid };
    run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', now(), u.id);
    startSession(reply, u.id);
    return reply.redirect('/app', 303);
  });

  app.post('/logout', async (req, reply) => { endSession(req, reply); return reply.redirect('/login', 303); });

  app.get('/invite/:token', async (req, reply) => {
    const inv = get<any>('SELECT i.*, t.name AS team_name, t.plan FROM invites i JOIN teams t ON t.id = i.team_id WHERE i.token = ? AND i.accepted_at IS NULL', (req.params as any).token);
    reply.type('text/html');
    if (!inv) return reply.code(404).send(page({ title: 'Invite not found', body: html`<div class="narrow card"><h1>Invite not found</h1><p>This invite was already used or withdrawn.</p></div>` }));
    const ctx = currentUser(req);
    if (!ctx) return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
    const seats = get<any>('SELECT COUNT(*) AS n FROM memberships WHERE team_id = ?', inv.team_id)!.n;
    try { assertCanAddSeat(planOf(inv.plan), seats); } catch (e) { if (e instanceof LimitError) return reply.code(403).send(page({ title: 'No free seat', user: ctx.user, body: html`<div class="narrow card"><h1>No free seat</h1><p>${e.message} Ask the team owner to upgrade.</p></div>` })); throw e; }
    run('DELETE FROM memberships WHERE user_id = ? AND role = ? AND NOT EXISTS (SELECT 1 FROM sites WHERE team_id = memberships.team_id)', ctx.user.id, 'owner');
    run("INSERT OR IGNORE INTO memberships (team_id, user_id, role, created_at) VALUES (?,?,'member',?)", inv.team_id, ctx.user.id, now());
    run('UPDATE invites SET accepted_at = ? WHERE token = ?', now(), inv.token);
    return reply.redirect('/app', 303);
  });
}
