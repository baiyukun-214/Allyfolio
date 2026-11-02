import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { all, get, run, now } from '../db.ts';
import { config } from '../config.ts';
import { t, normLocale, type Locale } from '../i18n.ts';
import { planOf, effectivePlanSql } from './plans.ts';
import { brandingFor, reportPdf } from './report.ts';
import { mailer } from './mailer.ts';

export const RECIPIENTS_MAX = 5;
export const SCHEDULES_PER_TEAM = 20;
/** Manual "send now" emails per team per rolling 24 h (one email per recipient). Limits misuse of our sending domain. */
export const MANUAL_SENDS_PER_DAY = 25;
export type Frequency = 'weekly' | 'monthly';
const EMAIL = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[a-z]{2,}$/i;

export function parseRecipients(raw: unknown): { ok: true; list: string[] } | { ok: false; reason: 'empty' | 'invalid' | 'tooMany'; value?: string } {
  const parts = String(raw ?? '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return { ok: false, reason: 'empty' };
  const bad = parts.find((p) => p.length > 254 || !EMAIL.test(p)); if (bad) return { ok: false, reason: 'invalid', value: bad.slice(0, 80) };
  const list = [...new Set(parts)]; if (list.length > RECIPIENTS_MAX) return { ok: false, reason: 'tooMany' };
  return { ok: true, list };
}
/** Weekly: next Monday 06:00 UTC. Monthly: the 1st of next month, 06:00 UTC. Always strictly after `from`. */
export function nextRunAt(freq: Frequency, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 6));
  if (freq === 'weekly') { while (d.getUTCDay() !== 1 || d <= from) d.setUTCDate(d.getUTCDate() + 1); }
  else { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); }
  return d.toISOString();
}
export const unsubToken = (scheduleId: string, email: string) => createHmac('sha256', config.sessionSecret).update(`report-unsub:${scheduleId}:${email.toLowerCase()}`).digest('base64url');
export function unsubOk(scheduleId: string, email: string, token: string) {
  const exp = unsubToken(scheduleId, email);
  return typeof token === 'string' && token.length === exp.length && timingSafeEqual(Buffer.from(token), Buffer.from(exp));
}
export const unsubUrl = (scheduleId: string, email: string) => `${config.appUrl}/r/unsubscribe?s=${encodeURIComponent(scheduleId)}&e=${encodeURIComponent(email)}&t=${unsubToken(scheduleId, email)}`;
export const unsubApiUrl = (scheduleId: string, email: string) => `${config.appUrl}/api/report-unsubscribe?s=${encodeURIComponent(scheduleId)}&e=${encodeURIComponent(email)}&t=${unsubToken(scheduleId, email)}`;
/** Remove one recipient from a schedule; a schedule with nobody left is paused. Returns false if not on it. */
export function unsubscribe(scheduleId: string, email: string): boolean {
  const s = get<any>('SELECT * FROM report_schedules WHERE id = ?', scheduleId); if (!s) return false;
  const list = s.recipients.split(',').filter(Boolean); const rest = list.filter((r: string) => r !== email.toLowerCase());
  if (rest.length === list.length) return false;
  run('UPDATE report_schedules SET recipients = ?, active = CASE WHEN ? = \'\' THEN 0 ELSE active END WHERE id = ?', rest.join(','), rest.join(','), scheduleId);
  return true;
}
export function manualSendsToday(teamId: string) {
  return get<any>("SELECT COUNT(*) AS n FROM report_deliveries WHERE team_id = ? AND kind = 'manual' AND status != 'skipped' AND created_at >= ?", teamId, new Date(Date.now() - 86_400_000).toISOString()).n as number;
}

export interface SendInput { siteId: string; recipients: string[]; locale: Locale; kind: 'manual' | 'scheduled'; scheduleId?: string | null; sentBy?: string | null; frequency?: Frequency }
export interface SendResult { status: 'sent' | 'partial' | 'failed' | 'skipped'; reason?: 'no_site' | 'plan' | 'no_scan'; sent: number; failed: number; scanId?: string }

/**
 * Email the latest finished scan report (PDF attached, white-label if the team has it) to each recipient separately.
 * Never throws for delivery problems: each recipient's outcome is recorded in report_deliveries, so a job retry
 * cannot send the same report twice.
 */
export async function sendLatestReport(x: SendInput): Promise<SendResult> {
  const site = get<any>(`SELECT s.*, t.id AS tid, t.name AS team_name, t.brand_name, t.brand_color, t.brand_logo_url, ${effectivePlanSql()} AS plan
    FROM sites s JOIN teams t ON t.id = s.team_id WHERE s.id = ?`, x.siteId);
  const at = now();
  const record = (recipient: string, status: string, scanId: string | null, error: string | null, teamId = site?.tid) => teamId && run(
    'INSERT INTO report_deliveries (id, team_id, site_id, schedule_id, scan_id, kind, recipient, status, error, sent_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    randomUUID(), teamId, x.siteId, x.scheduleId ?? null, scanId, x.kind, recipient, status, error, x.sentBy ?? null, at);
  if (!site || !site.verified_at) return { status: 'skipped', reason: 'no_site', sent: 0, failed: 0 };
  const plan = planOf(site.plan);
  if (!plan.pdf) { record(x.recipients.join(','), 'skipped', null, 'plan'); return { status: 'skipped', reason: 'plan', sent: 0, failed: 0 }; }
  const scan = get<any>("SELECT * FROM scans WHERE site_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1", site.id);
  if (!scan) { record(x.recipients.join(','), 'skipped', null, 'no_scan'); return { status: 'skipped', reason: 'no_scan', sent: 0, failed: 0 }; }
  const l = normLocale(x.locale) ?? 'en', E = t(l).er;
  const branding = await brandingFor({ plan: site.plan, brand_name: site.brand_name, brand_color: site.brand_color, brand_logo_url: site.brand_logo_url });
  const pdf = await reportPdf(scan.id, branding, l);
  const sender = x.sentBy ? get<any>('SELECT u.email FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.id = ? AND m.team_id = ?', x.sentBy, site.tid)?.email : null;
  const owner = get<any>("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND m.role = 'owner' ORDER BY m.created_at LIMIT 1", site.tid)?.email;
  const replyTo = sender ?? owner ?? undefined;
  const brand = branding.whiteLabel ? branding.name : 'Allyfolio';
  const date = new Date(scan.finished_at).toLocaleDateString(t(l).dateLocale, { dateStyle: 'long', timeZone: 'UTC' });
  let sent = 0, failed = 0;
  for (const to of x.recipients) {
    const unsub = x.kind === 'scheduled' && x.scheduleId ? unsubUrl(x.scheduleId, to) : null;
    const text = [E.mailHello, '', E.mailIntro(site.name, site.origin, date), '',
      E.mailCounts(scan.pages_scanned, scan.critical, scan.serious, scan.moderate, scan.minor),
      ...(scan.new_issues != null ? [E.mailCompared(scan.new_issues, scan.fixed_issues ?? 0)] : []), '',
      E.mailLimits, '', E.mailSentBy(brand, branding.whiteLabel, replyTo ?? brand),
      ...(unsub ? ['', E.mailWhy(x.frequency === 'monthly' ? E.monthly : E.weekly), E.mailUnsub(unsub)] : [])].join('\n');
    try {
      await mailer.send({ to, subject: E.mailSubject(site.name, date), text, replyTo, fromName: branding.whiteLabel ? `${brand} via Allyfolio` : undefined,
        attachments: [{ filename: `accessibility-report-${scan.finished_at.slice(0, 10)}.pdf`, content: pdf, contentType: 'application/pdf' }],
        headers: unsub ? { 'List-Unsubscribe': `<${unsubApiUrl(x.scheduleId!, to)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined });
      record(to, 'sent', scan.id, null); sent++;
    } catch (e: any) { record(to, 'failed', scan.id, String(e?.message ?? e).slice(0, 300)); failed++; }
  }
  return { status: failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial', sent, failed, scanId: scan.id };
}

/** Scheduler tick: enqueue one job per due, active schedule and move its next run forward. */
export function enqueueDueReports(enqueue: (type: any, payload: object) => unknown): number {
  const due = all<any>("SELECT id, frequency FROM report_schedules WHERE active = 1 AND recipients != '' AND next_run_at IS NOT NULL AND next_run_at <= ?", now());
  for (const s of due) {
    enqueue('report_email', { scheduleId: s.id });
    run('UPDATE report_schedules SET next_run_at = ?, last_run_at = ? WHERE id = ?', nextRunAt(s.frequency), now(), s.id);
  }
  return due.length;
}
export async function runScheduledReport(p: { scheduleId: string }) {
  const s = get<any>('SELECT * FROM report_schedules WHERE id = ?', p.scheduleId);
  if (!s || !s.active || !s.recipients) return null;
  return sendLatestReport({ siteId: s.site_id, recipients: s.recipients.split(','), locale: s.locale, kind: 'scheduled', scheduleId: s.id, sentBy: s.created_by, frequency: s.frequency });
}
export async function runManualReport(p: { siteId: string; recipients: string[]; locale: Locale; sentBy: string }) {
  return sendLatestReport({ ...p, kind: 'manual' });
}
