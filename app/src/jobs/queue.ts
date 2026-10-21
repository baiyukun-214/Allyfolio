import { get, run, now, all } from '../db.ts';
import { planOf, nextScanAt } from '../lib/plans.ts';
export type JobType = 'site_scan' | 'retention' | 'apply_downgrades';
export function enqueue(type: JobType, payload: object, runAt = now()) {
  return run('INSERT INTO jobs (type, payload, run_at, created_at) VALUES (?,?,?,?)', type, JSON.stringify(payload), runAt, now()).lastInsertRowid;
}
/** Atomically claim the next due job. Stale locks (crashed worker) are retried after 30 min. */
export function claim(): any | undefined {
  const t = now(), stale = new Date(Date.now() - 30 * 60_000).toISOString();
  return get(`UPDATE jobs SET status = 'running', locked_at = ?, attempts = attempts + 1 WHERE id = (
    SELECT id FROM jobs WHERE (status = 'queued' AND run_at <= ?) OR (status = 'running' AND locked_at < ?) ORDER BY run_at LIMIT 1) RETURNING *`, t, t, stale);
}
export function complete(id: number) { run("UPDATE jobs SET status = 'done' WHERE id = ?", id); }
export function fail(id: number, err: string, attempts: number) {
  if (attempts >= 3) run("UPDATE jobs SET status = 'failed', last_error = ? WHERE id = ?", err, id);
  else run("UPDATE jobs SET status = 'queued', last_error = ?, run_at = ? WHERE id = ?", err, new Date(Date.now() + attempts * 5 * 60_000).toISOString(), id);
}
export const hasPendingScan = (siteId: string) => !!get("SELECT 1 FROM jobs WHERE type = 'site_scan' AND status IN ('queued','running') AND json_extract(payload, '$.siteId') = ?", siteId);
export function scheduleFirstScan(siteId: string, team: any) {
  const plan = planOf(team.plan);
  if (!plan.frequency) return;
  if (!hasPendingScan(siteId)) enqueue('site_scan', { siteId, kind: 'scheduled' });
  run('UPDATE sites SET next_scan_at = ? WHERE id = ?', nextScanAt(plan), siteId);
}
/** Scheduler tick: enqueue due scheduled scans per plan frequency. */
export function enqueueDueScans(): number {
  const due = all<any>(`SELECT s.id, t.plan FROM sites s JOIN teams t ON t.id = s.team_id WHERE s.verified_at IS NOT NULL AND s.next_scan_at IS NOT NULL AND s.next_scan_at <= ? AND t.plan != 'none'`, now());
  for (const s of due) {
    if (!hasPendingScan(s.id)) enqueue('site_scan', { siteId: s.id, kind: 'scheduled' });
    run('UPDATE sites SET next_scan_at = ? WHERE id = ?', nextScanAt(planOf(s.plan)), s.id);
  }
  return due.length;
}
