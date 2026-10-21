import { randomBytes } from 'node:crypto';
import { get, run, now, tx } from '../db.ts';
import { config } from '../config.ts';
import { mailer } from './mailer.ts';
export const EARLY_BIRD_LIMIT = 100;
const EMAIL_RE = /^[^\s@<>()"']{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;
export const validEmail = (e: string) => EMAIL_RE.test(e) && e.length <= 254;

export async function joinWaitlist(emailRaw: string, ip: string) {
  const email = String(emailRaw ?? '').trim().toLowerCase();
  if (!validEmail(email)) return { ok: false as const, error: 'Please enter a valid email address.' };
  const existing = get<any>('SELECT * FROM waitlist WHERE email = ?', email);
  if (existing?.confirmed_at) return { ok: true as const }; // don't reveal membership
  const token = existing?.token ?? randomBytes(24).toString('base64url');
  if (!existing) run('INSERT INTO waitlist (email, token, created_at, source_ip) VALUES (?,?,?,?)', email, token, now(), ip);
  const link = `${config.appUrl}/api/waitlist/confirm?token=${token}`;
  await mailer.send({ to: email, subject: 'Confirm your place on the Allyfolio waitlist',
    text: `Hi,\n\nplease confirm your email to join the Allyfolio waitlist:\n${link}\n\nThe first ${EARLY_BIRD_LIMIT} confirmed waitlist members get 30% off their first year.\nIf you did not sign up, ignore this email – we will not contact you again.\n\nAllyfolio` });
  return { ok: true as const };
}
export function confirmWaitlist(token: string): { ok: boolean; earlyBird?: boolean } {
  return tx(() => {
    const row = get<any>('SELECT * FROM waitlist WHERE token = ?', String(token ?? ''));
    if (!row) return { ok: false };
    if (row.confirmed_at) return { ok: true, earlyBird: !!row.early_bird };
    const count = get<any>('SELECT COUNT(*) AS n FROM waitlist WHERE early_bird = 1')!.n as number;
    const eb = count < EARLY_BIRD_LIMIT ? 1 : 0;
    run('UPDATE waitlist SET confirmed_at = ?, early_bird = ? WHERE id = ?', now(), eb, row.id);
    return { ok: true, earlyBird: !!eb };
  });
}
export const isEarlyBird = (email: string) => !!get<any>('SELECT 1 FROM waitlist WHERE email = ? AND confirmed_at IS NOT NULL AND early_bird = 1', email.toLowerCase());
