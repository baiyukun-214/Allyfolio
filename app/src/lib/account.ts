// Account self-service: password reset, GDPR data export (Art. 15/20) and account deletion (Art. 17).
import { randomBytes } from 'node:crypto';
import { get, all, run, now, tx } from '../db.ts';
import { sha256, hashPassword } from './auth.ts';
import { cancelSubscription } from './billing/index.ts';

export const RESET_TTL_MS = 60 * 60_000;

/** Create a single-use reset token (only its hash is stored). Earlier unused tokens for the user are revoked. */
export function createPasswordReset(userId: string, ttlMs = RESET_TTL_MS) {
  const token = randomBytes(32).toString('base64url');
  tx(() => {
    run('DELETE FROM password_resets WHERE user_id = ?', userId);
    run('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)', sha256(token), userId, new Date(Date.now() + ttlMs).toISOString(), now());
  });
  return token;
}
export const findValidReset = (token: string) =>
  get<any>('SELECT r.*, u.email, u.locale FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?', sha256(String(token ?? '')), now());

/** Consume the token, set the new password and sign the user out everywhere. Returns the user or null if the token is not valid. */
export async function resetPassword(token: string, newPassword: string) {
  const hash = await hashPassword(newPassword);
  return tx(() => {
    const r = findValidReset(token); if (!r) return null;
    const used = run('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', now(), r.token_hash);
    if (!used.changes) return null; // lost a race with a parallel request
    run('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', hash, now(), r.user_id);
    run('DELETE FROM sessions WHERE user_id = ?', r.user_id);
    run('DELETE FROM password_resets WHERE user_id = ?', r.user_id);
    run('DELETE FROM login_tokens WHERE email = ?', r.email);
    return { id: r.user_id as string, email: r.email as string, locale: r.locale as string | null };
  });
}

/** Everything we hold about a user, as portable JSON. Secrets (password hash, session/token ids) are never included. */
export function exportUserData(userId: string) {
  const user = get<any>('SELECT id, email, name, locale, created_at, email_verified_at, password_hash IS NOT NULL AS has_password FROM users WHERE id = ?', userId);
  if (!user) return null;
  const memberships = all<any>('SELECT m.role, m.created_at AS joined_at, t.* FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY m.created_at', userId);
  return {
    format: 'allyfolio-data-export', version: 1, exported_at: now(),
    user: { ...user, has_password: !!user.has_password },
    teams: memberships.map((t) => ({
      id: t.id, name: t.name, role: t.role, joined_at: t.joined_at, plan: t.plan,
      ...(t.role === 'owner' ? { billing: { provider_customer_id: t.billing_customer_id, provider_subscription_id: t.billing_subscription_id, status: t.subscription_status, current_period_end: t.current_period_end, pending_plan: t.pending_plan, cancel_at: t.cancel_at, oneoff_credits: t.oneoff_credits },
        branding: { name: t.brand_name, color: t.brand_color, logo_url: t.brand_logo_url } } : {}),
      members: all<any>('SELECT u.email, m.role, m.created_at AS joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.created_at', t.id),
      invites: all<any>('SELECT email, created_at, accepted_at FROM invites WHERE team_id = ?', t.id),
      sites: all<any>('SELECT id, name, origin, verified_at, verify_method, created_at, next_scan_at FROM sites WHERE team_id = ? ORDER BY created_at', t.id).map((s) => ({
        ...s, scans: all<any>('SELECT id, kind, status, created_at, finished_at, pages_scanned, critical, serious, moderate, minor, new_issues, fixed_issues, evidence_hash FROM scans WHERE site_id = ? ORDER BY created_at', s.id),
      })),
    })),
    invites_received: all<any>('SELECT i.created_at, i.accepted_at, t.name AS team FROM invites i JOIN teams t ON t.id = i.team_id WHERE i.email = ?', user.email),
    sessions: all<any>('SELECT created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at', userId),
    waitlist: get<any>('SELECT email, created_at, confirmed_at, early_bird, locale FROM waitlist WHERE email = ?', user.email) ?? null,
  };
}

export interface DeletionResult { transferredTeams: string[]; deletedTeams: string[]; canceledSubscriptions: number }
/**
 * Delete a user and their personal data.
 * Owned teams: ownership moves to the longest-standing other member; teams without other members are deleted
 * (sites, scans, invites cascade) after their subscription is canceled immediately. If a cancellation fails, nothing is deleted.
 */
export async function deleteAccount(userId: string): Promise<DeletionResult> {
  const user = get<any>('SELECT * FROM users WHERE id = ?', userId); if (!user) throw new Error('no such user');
  const owned = all<any>("SELECT t.* FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? AND m.role = 'owner'", userId);
  const plan = owned.map((t) => ({ team: t, heir: get<any>("SELECT user_id FROM memberships WHERE team_id = ? AND user_id != ? ORDER BY created_at, user_id LIMIT 1", t.id, userId) }));
  // External side effects first: cancel subscriptions of teams that will be deleted.
  let canceled = 0;
  for (const { team, heir } of plan) if (!heir && team.billing_subscription_id) { await cancelSubscription(team, 'immediately'); canceled++; }
  return tx(() => {
    const res: DeletionResult = { transferredTeams: [], deletedTeams: [], canceledSubscriptions: canceled };
    for (const { team, heir } of plan) {
      if (heir) { run("UPDATE memberships SET role = 'owner' WHERE team_id = ? AND user_id = ?", team.id, heir.user_id); res.transferredTeams.push(team.id); }
      else {
        for (const s of all<any>('SELECT id FROM sites WHERE team_id = ?', team.id)) run("DELETE FROM jobs WHERE status IN ('queued','running') AND payload LIKE ?", `%"siteId":"${s.id}"%`);
        run('DELETE FROM teams WHERE id = ?', team.id); res.deletedTeams.push(team.id);
      }
    }
    run('DELETE FROM login_tokens WHERE email = ?', user.email);
    run('DELETE FROM invites WHERE email = ? AND accepted_at IS NULL', user.email);
    run('UPDATE invites SET email = ? WHERE email = ?', '[deleted]', user.email); // accepted invites: keep the team's record, drop the address
    run('DELETE FROM waitlist WHERE email = ?', user.email);
    run('DELETE FROM users WHERE id = ?', userId); // cascades: sessions, memberships, password_resets
    return res;
  });
}
