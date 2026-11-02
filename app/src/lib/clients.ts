import { all, get } from '../db.ts';
import { planOf } from './plans.ts';
export const CLIENTS_PER_TEAM = 100;
export const NAME_MAX = 80, NOTES_MAX = 2000;
export const EMAIL = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[a-z]{2,}$/i;
/** Client of a site, only while the team's plan includes client workspaces. */
export function clientOfSite(siteId: string): { id: string; name: string; contact_email: string | null } | null {
  const r = get<any>(`SELECT c.id, c.name, c.contact_email, t.plan, t.plan_override FROM sites s JOIN clients c ON c.id = s.client_id JOIN teams t ON t.id = s.team_id WHERE s.id = ?`, siteId);
  if (!r) return null;
  const plan = r.plan_override && ['none', 'starter', 'business', 'agency'].includes(r.plan_override) ? r.plan_override : r.plan;
  return planOf(plan).clients ? { id: r.id, name: r.name, contact_email: r.contact_email } : null;
}
/** Per-site latest-scan rows for a team, optionally limited to one client ('' = no client). */
export function siteRows(teamId: string, clientId?: string | null) {
  const where = clientId === undefined ? '' : clientId === '' ? ' AND s.client_id IS NULL' : ' AND s.client_id = ?';
  const p: any[] = [teamId]; if (clientId) p.push(clientId);
  return all<any>(`SELECT s.*, c.name AS client_name,
      (SELECT finished_at FROM scans WHERE site_id = s.id AND status='done' ORDER BY created_at DESC LIMIT 1) AS last_scan,
      (SELECT critical+serious FROM scans WHERE site_id = s.id AND status='done' ORDER BY created_at DESC LIMIT 1) AS last_serious,
      (SELECT COUNT(*) FROM report_schedules r WHERE r.site_id = s.id AND r.active = 1) AS schedules
    FROM sites s LEFT JOIN clients c ON c.id = s.client_id WHERE s.team_id = ?${where} ORDER BY s.created_at`, ...p);
}
