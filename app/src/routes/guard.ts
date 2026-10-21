import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUser, type Ctx } from '../lib/auth.ts';
import { page, type PageOpts } from '../views/layout.ts';
import { get } from '../db.ts';
export function requireUser(req: FastifyRequest, reply: FastifyReply): Ctx | null {
  const c = currentUser(req);
  if (!c) { reply.redirect('/login'); return null; }
  return c;
}
export function render(reply: FastifyReply, ctx: Ctx | null, opts: Omit<PageOpts, 'user'>, code = 200) {
  const q = (reply.request.query ?? {}) as any;
  const flash = opts.flash ?? (q.ok ? { kind: 'ok' as const, msg: String(q.ok).slice(0, 200) } : q.err ? { kind: 'error' as const, msg: String(q.err).slice(0, 200) } : null);
  return reply.code(code).type('text/html').send(page({ ...opts, flash, user: ctx?.user }));
}
export const back = (reply: FastifyReply, path: string, kind: 'ok' | 'err', msg: string) => reply.redirect(`${path}${path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(msg)}`, 303);
/** Site must belong to the user's team. */
export const ownSite = (ctx: Ctx, id: string) => get<any>('SELECT * FROM sites WHERE id = ? AND team_id = ?', id, ctx.team.id);
