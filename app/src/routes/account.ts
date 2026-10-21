import type { FastifyInstance } from 'fastify';
import { get } from '../db.ts';
import { config } from '../config.ts';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import { mailer } from '../lib/mailer.ts';
import { validEmail } from '../lib/waitlist.ts';
import { rateLimiter } from '../lib/ratelimit.ts';
import { verifyPassword, endSession } from '../lib/auth.ts';
import { createPasswordReset, findValidReset, resetPassword, exportUserData, deleteAccount } from '../lib/account.ts';
import { requireUser, back, pg, loc, T } from './guard.ts';
import { authForm } from './auth.ts';
import { t } from '../i18n.ts';

const forgotLimit = rateLimiter(10, 60 * 60_000);
const deleteLimit = rateLimiter(10, 15 * 60_000);
const narrow = (inner: any) => html`<div class="narrow"><div class="card">${inner}</div></div>`;

export async function accountRoutes(app: FastifyInstance) {
  // ---- Forgot / reset password (public) ----
  app.get('/forgot', async (req, reply) => {
    const A = T(req).acct; reply.type('text/html');
    return pg(req, { backToSite: true, title: A.forgotTitle, body: narrow(html`<h1>${A.forgotTitle}</h1><p class="muted">${A.forgotLead}</p>
      <form method="post" action="/forgot">${csrfField(req)}<div class="field"><label for="email">${T(req).auth.email}</label><input id="email" name="email" type="email" autocomplete="email" required></div>
      <button class="btn btn-primary" type="submit">${A.sendLink}</button></form>`) });
  });
  app.post('/forgot', async (req, reply) => {
    const email = String((req.body as any).email ?? '').trim().toLowerCase();
    // Same answer whether or not the account exists (no account enumeration); limited per IP and per address.
    if (validEmail(email) && forgotLimit.take(req.ip).ok && forgotLimit.take('e:' + email).ok) {
      const u = get<any>('SELECT id, locale FROM users WHERE email = ?', email);
      if (u) {
        const token = createPasswordReset(u.id); const A = t(u.locale ?? loc(req)).acct;
        await mailer.send({ to: email, subject: A.resetSubject, text: A.resetBody(`${config.appUrl}/reset?token=${token}`) });
      }
    }
    const A = T(req).acct; reply.type('text/html');
    return pg(req, { backToSite: true, title: A.sentTitle, body: narrow(html`<h1>${A.sentTitle}</h1><p>${A.sent}</p>`) });
  });
  const resetForm = (req: any, token: string, error?: string) => {
    const A = T(req).acct;
    return pg(req, { backToSite: true, title: A.resetTitle, flash: error ? { kind: 'error', msg: error } : null, body: narrow(html`<h1>${A.resetTitle}</h1>
      <form method="post" action="/reset">${csrfField(req)}<input type="hidden" name="token" value="${token}">
        <div class="field"><label for="password">${A.newPw}</label><p class="hint" id="password-hint">${T(req).auth.pwHint}</p><input id="password" name="password" type="password" autocomplete="new-password" required minlength="10" aria-describedby="password-hint"></div>
        <button class="btn btn-primary" type="submit">${A.resetBtn}</button></form>`) });
  };
  const invalid = (req: any) => { const A = T(req).acct; return pg(req, { backToSite: true, title: A.resetTitle, body: narrow(html`<h1>${A.resetTitle}</h1><p role="alert">${A.resetInvalid}</p><p><a href="/forgot">${A.forgotLink}</a></p>`) }); };
  app.get('/reset', async (req, reply) => {
    const token = String((req.query as any).token ?? ''); reply.type('text/html').header('referrer-policy', 'no-referrer');
    return findValidReset(token) ? resetForm(req, token) : reply.code(400).send(invalid(req));
  });
  app.post('/reset', async (req, reply) => {
    const { token, password } = req.body as any; reply.type('text/html');
    if (String(password ?? '').length < 10) return reply.code(400).send(findValidReset(token) ? resetForm(req, String(token), T(req).auth.pwShort) : invalid(req));
    const u = await resetPassword(String(token ?? ''), String(password));
    if (!u) return reply.code(400).send(invalid(req));
    const A = t(u.locale ?? loc(req)).acct;
    await mailer.send({ to: u.email, subject: A.changedSubject, text: A.changedBody });
    endSession(req, reply); // this browser too
    return authForm(req, 'login', undefined, u.email, T(req).acct.resetDone);
  });

  // ---- Data export (GDPR Art. 15/20) ----
  app.get('/app/account/export', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const data = exportUserData(ctx.user.id);
    return reply.type('application/json; charset=utf-8').header('cache-control', 'no-store')
      .header('content-disposition', `attachment; filename="allyfolio-data-export-${new Date().toISOString().slice(0, 10)}.json"`).send(JSON.stringify(data, null, 2));
  });

  // ---- Account deletion (GDPR Art. 17) ----
  app.post('/app/account/delete', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const l = loc(req, ctx), A = t(l).acct; const { password, confirm_email } = req.body as any;
    if (!deleteLimit.take(ctx.user.id).ok) return back(reply, '/app/settings', 'err', t(l).auth.tooMany);
    const u = get<any>('SELECT password_hash FROM users WHERE id = ?', ctx.user.id);
    const ok = u.password_hash ? await verifyPassword(String(password ?? ''), u.password_hash) : String(confirm_email ?? '').trim().toLowerCase() === ctx.user.email;
    if (!ok) return back(reply, '/app/settings', 'err', A.deleteWrong);
    try { await deleteAccount(ctx.user.id); } catch (e) { req.log.error(e); return back(reply, '/app/settings', 'err', A.deleteFail); }
    await mailer.send({ to: ctx.user.email, subject: A.deletedSubject, text: A.deletedBody }).catch((e) => req.log.error(e));
    endSession(req, reply);
    reply.type('text/html');
    return pg(req, { backToSite: true, title: A.deletedTitle, locale: l, body: narrow(html`<h1>${A.deletedTitle}</h1><p role="status">${A.deleted}</p>`) } as any);
  });
}
/** Settings-page section: export + delete. */
export function accountSection(req: any, ctx: any) {
  const l = loc(req, ctx), A = t(l).acct;
  const hasPw = !!get<any>('SELECT password_hash FROM users WHERE id = ?', ctx.user.id)?.password_hash;
  return html`<h2>${A.accountH}</h2>
  <section class="card" aria-labelledby="export-h" style="margin-bottom:16px"><h3 id="export-h" style="margin-top:0">${A.exportH}</h3><p class="small muted">${A.exportText}</p>
    <a class="btn btn-secondary" href="/app/account/export" download>${A.exportBtn}</a></section>
  <section class="card danger-zone" aria-labelledby="delete-h"><h3 id="delete-h" style="margin-top:0">${A.deleteH}</h3><p class="small">${A.deleteText}</p>
    <form method="post" action="/app/account/delete">${csrfField(req)}
      ${hasPw ? html`<div class="field"><label for="del-password">${A.confirmPw}</label><input id="del-password" name="password" type="password" autocomplete="current-password" required></div>`
        : html`<div class="field"><label for="del-email">${A.confirmEmail(ctx.user.email)}</label><input id="del-email" name="confirm_email" type="email" autocomplete="off" required></div>`}
      <button class="btn btn-danger" type="submit">${A.deleteBtn}</button></form></section>`;
}

