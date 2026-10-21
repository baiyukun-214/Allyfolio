// Pure helpers for dashboard summaries. The score reflects automated checks only (roughly 57% of issues).
export interface ScanCounts { critical: number; serious: number; moderate: number; minor: number; pages_scanned: number; fixed_issues?: number | null; finished_at?: string | null }
export const totalIssues = (s: ScanCounts) => (s.critical ?? 0) + (s.serious ?? 0) + (s.moderate ?? 0) + (s.minor ?? 0);
/** 0–100: 100 minus 4 points per weighted issue per page (critical 10, serious 5, moderate 2, minor 1). */
export function automatedScore(s: ScanCounts): number {
  const w = 10 * (s.critical ?? 0) + 5 * (s.serious ?? 0) + 2 * (s.moderate ?? 0) + (s.minor ?? 0);
  return Math.max(0, Math.min(100, Math.round(100 - 4 * (w / Math.max(1, s.pages_scanned ?? 0)))));
}
/** Done scans, newest first. Returns a series (oldest→newest, max 10), delta vs the newest scan at least 7 days older, and fixed in the last 7 days. */
export function weeklyTrend(done: ScanCounts[], nowMs = Date.now()) {
  const series = done.slice(0, 10).map(totalIssues).reverse();
  const latest = done[0]; const week = 7 * 86400_000;
  let delta: number | null = null;
  if (latest?.finished_at) {
    const ref = done.find((s) => s.finished_at && Date.parse(latest.finished_at!) - Date.parse(s.finished_at) >= week);
    if (ref) delta = totalIssues(latest) - totalIssues(ref);
  }
  const fixedWeek = done.filter((s) => s.finished_at && nowMs - Date.parse(s.finished_at) <= week).reduce((a, s) => a + (s.fixed_issues ?? 0), 0);
  return { series, delta, fixedWeek };
}
