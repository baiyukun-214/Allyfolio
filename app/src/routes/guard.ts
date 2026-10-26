import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUser, type Ctx } from '../lib/auth.ts';
import { page, type PageOpts } from '../views/layout.ts';
import { html, type Html } from '../lib/html.ts';
import { get } from '../db.ts';
import { normLocale, requestLocale, t, type Locale } from '../i18n.ts';
declare module 'fastify' { interface FastifyRequest { locale: Locale } }
/** Locale priority: user setting > ?lang (persisted to cookie) > cookie > Accept-Language. */
export const loc = (req: FastifyRequest, ctx?: Ctx | null): Locale => normLocale(ctx?.user?.locale) ?? req.locale ?? 'en';
export const T = (req: FastifyRequest, ctx?: Ctx | null) => t(loc(req, ctx));
export function localeHook(req: FastifyRequest, reply: FastifyReply, done: () => void) { req.locale = requestLocale(req, reply); done(); }
export function requireUser(req: FastifyRequest, reply: FastifyReply): Ctx | null {
  const c = currentUser(req);
  if (!c) { reply.redirect('/login'); return null; }
  return c;
}
export function render(reply: FastifyReply, ctx: Ctx | null, opts: Omit<PageOpts, 'user' | 'locale' | 'path'>, code = 200) {
  const req = reply.request; const q = (req.query ?? {}) as any;
  const flash = opts.flash ?? (q.paid ? { kind: 'ok' as const, msg: t(loc(req, ctx)).bill.paid } : q.ok ? { kind: 'ok' as const, msg: String(q.ok).slice(0, 200) } : q.err ? { kind: 'error' as const, msg: String(q.err).slice(0, 200) } : null);
  const path = req.url.split('?')[0];
  return reply.code(code).type('text/html').send(page({ ...opts, flash, user: ctx?.user, locale: loc(req, ctx), path }));
}
export const back = (reply: FastifyReply, path: string, kind: 'ok' | 'err', msg: string) => reply.redirect(`${path}${path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(msg)}`, 303);
/** Site must belong to the user's team. */
export const ownSite = (ctx: Ctx, id: string) => get<any>('SELECT * FROM sites WHERE id = ? AND team_id = ?', id, ctx.team.id);
/** Render a full page for a request without going through reply (locale + switcher path from the request). */
export const pg = (req: FastifyRequest, opts: Omit<PageOpts, 'locale' | 'path'>, ctx?: Ctx | null) => page({ ...opts, locale: loc(req, ctx), path: req.url.split('?')[0] });
export const fmtDate = (iso: string | null | undefined, l: Locale) => iso ? new Date(iso).toLocaleString(t(l).dateLocale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '–';
/** Date only (UTC fallback, no time/zone label), for plain-text contexts such as flash messages. */
export const fmtDay = (iso: string | null | undefined, l: Locale) => iso ? new Date(iso).toLocaleDateString(t(l).dateLocale, { dateStyle: 'medium', timeZone: 'UTC' }) : '–';
/**
 * <time datetime=ISO> with a server-side UTC fallback; public/app.js re-renders it in the viewer's timezone with
 * Intl.DateTimeFormat (data-locale, data-local="date" | "datetime"). Date-only fallback carries no zone label.
 */
export function localTime(iso: string | null | undefined, l: Locale, kind: 'date' | 'datetime' = 'datetime'): Html {
  if (!iso) return html`–`;
  const d = new Date(iso); if (isNaN(d.getTime())) return html`–`;
  return html`<time datetime="${d.toISOString()}" data-local="${kind}" data-locale="${t(l).dateLocale}">${kind === 'date' ? fmtDay(iso, l) : fmtDate(iso, l)}</time>`;
}
