import { randomBytes, randomUUID, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { get, run, now, tx } from '../db.ts';
import { config } from '../config.ts';
const scrypt = promisify(_scrypt) as (p: string, s: Buffer, n: number) => Promise<Buffer>;
export const SESSION_COOKIE = 'af_session';
const SESSION_DAYS = 30;

export async function hashPassword(pw: string) { const salt = randomBytes(16); const h = await scrypt(pw, salt, 64); return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`; }
export async function verifyPassword(pw: string, stored: string | null) {
  if (!stored) return false; const [, s, h] = stored.split('$'); const exp = Buffer.from(h, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), exp.length); return timingSafeEqual(got, exp);
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createUserWithTeam(email: string, passwordHash: string | null, name = '', locale: string | null = null, teamName?: string) {
  return tx(() => {
    const uid = randomUUID(), tid = randomUUID(), t = now();
    run('INSERT INTO users (id, email, password_hash, name, created_at, locale) VALUES (?,?,?,?,?,?)', uid, email, passwordHash, name, t, locale);
    run('INSERT INTO teams (id, name, created_at) VALUES (?,?,?)', tid, teamName ?? `${name || email.split('@')[0]}'s team`, t);
    run("INSERT INTO memberships (team_id, user_id, role, created_at) VALUES (?,?,'owner',?)", tid, uid, t);
    return { uid, tid };
  });
}
export function startSession(reply: FastifyReply, userId: string) {
  const id = randomBytes(32).toString('base64url');
  run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)', sha256(id), userId, now(), new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString());
  reply.setCookie(SESSION_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.appUrl.startsWith('https'), signed: true, maxAge: SESSION_DAYS * 86400 });
}
export function endSession(req: FastifyRequest, reply: FastifyReply) {
  const sid = readSid(req); if (sid) run('DELETE FROM sessions WHERE id = ?', sha256(sid));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
function readSid(req: FastifyRequest) { const c = req.cookies[SESSION_COOKIE]; if (!c) return null; const u = req.unsignCookie(c); return u.valid ? u.value : null; }
export interface Ctx { user: { id: string; email: string; name: string; locale?: string | null }; team: any; role: string }
export function currentUser(req: FastifyRequest): Ctx | null {
  const sid = readSid(req); if (!sid) return null;
  const u = get<any>('SELECT u.id, u.email, u.name, u.locale FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?', sha256(sid), now());
  if (!u) return null;
  const m = get<any>('SELECT t.*, m.role FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY m.created_at LIMIT 1', u.id);
  return { user: u, team: m, role: m?.role };
}
export function createLoginToken(email: string) {
  const token = randomBytes(32).toString('base64url');
  run('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?,?,?)', sha256(token), email, new Date(Date.now() + 15 * 60_000).toISOString());
  return token;
}
export function consumeLoginToken(token: string): string | null {
  return tx(() => {
    const r = get<any>('SELECT * FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', sha256(String(token ?? '')), now());
    if (!r) return null; run('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?', now(), r.token_hash); return r.email as string;
  });
}
