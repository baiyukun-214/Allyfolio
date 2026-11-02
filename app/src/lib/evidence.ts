/*
 * Scan evidence chain: every finished scan stores a SHA-256 hash that covers its records and the previous
 * finished scan's hash (prev_hash), so the scan history of a site forms a hash chain. Changing, removing or
 * reordering a recorded scan, page or issue makes the recomputed hash differ from the stored one.
 * This makes the history traceable and lets anyone with the data re-verify it; it does not by itself stop a
 * database administrator from rewriting the whole chain. The daily off-site anchor of chain heads
 * (deploy/anchor.sh) is what pins past heads outside the database.
 *
 * Hash schemes (scans.hash_version):
 *   1 (NULL in old rows) – scan id, site id, finished_at, sorted page URLs and sorted distinct issue fingerprints.
 *   2 – everything in v1 plus every field of every issue record (page, rule, impact, WCAG refs, help text,
 *       help URL, target, HTML snippet, fingerprint), page status/error, scan kind, page limit, counts,
 *       new/fixed counts and crawl coverage. Old v1 rows are never rehashed; the verifier checks each row
 *       with the scheme it was written with.
 */
import { createHash } from 'node:crypto';
import { all } from '../db.ts';

export const HASH_VERSION = 2;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function evidenceHashV1(prevHash: string | null, scan: { id: string; siteId: string; finishedAt: string; pages: string[]; fingerprints: string[] }) {
  return sha(JSON.stringify({ prev: prevHash ?? null, id: scan.id, site: scan.siteId, finished: scan.finishedAt, pages: [...scan.pages].sort(), issues: [...scan.fingerprints].sort() }));
}

export interface IssueRecord { page_url: string; rule_id: string; impact: string; wcag: string | null; help: string; help_url: string | null; target: string; html: string | null; fingerprint: string }
export interface PageRecord { url: string; status: number | null; error: string | null }
export interface ScanRecord {
  id: string; site_id: string; kind: string; finished_at: string; page_limit: number | null; pages_scanned: number;
  critical: number; serious: number; moderate: number; minor: number; new_issues: number | null; fixed_issues: number | null; crawl: string | null;
}
const str = (x: unknown) => JSON.stringify(x);
const issueKey = (i: IssueRecord) => str([i.page_url, i.rule_id, i.impact, i.wcag ?? null, i.help, i.help_url ?? null, i.target, i.html ?? null, i.fingerprint]);
const pageKey = (p: PageRecord) => str([p.url, p.status ?? null, p.error ?? null]);

export function evidenceHashV2(prevHash: string | null, s: ScanRecord, pages: PageRecord[], issues: IssueRecord[]) {
  return sha(str({
    v: 2, prev: prevHash ?? null, id: s.id, site: s.site_id, kind: s.kind, finished: s.finished_at, limit: s.page_limit ?? null,
    pagesScanned: s.pages_scanned, counts: [s.critical, s.serious, s.moderate, s.minor], new: s.new_issues ?? null, fixed: s.fixed_issues ?? null,
    crawl: s.crawl ?? null, pages: pages.map(pageKey).sort(), issues: issues.map(issueKey).sort(),
  }));
}

/** Recompute a site's whole scan chain from the stored rows. ok=false names the first scan that does not match. */
export function verifyScanChain(siteId: string): { ok: boolean; count: number; head: string | null; brokenAt: string | null; reason?: string; versions: Record<string, number>; pruned: boolean } {
  const scans = all<any>("SELECT * FROM scans WHERE site_id = ? AND status = 'done' ORDER BY finished_at, id", siteId);
  // Retention deletes the oldest scans, so the oldest remaining scan may link to a hash that is no longer stored (pruned=true).
  let prev: string | null = scans[0]?.prev_hash ?? null; const versions: Record<string, number> = {}; const pruned = prev !== null;
  for (const s of scans) {
    const v = s.hash_version ?? 1; versions[`v${v}`] = (versions[`v${v}`] ?? 0) + 1;
    const fail = (reason: string) => ({ ok: false, count: scans.length, head: scans.at(-1)!.evidence_hash, brokenAt: s.id as string, reason, versions, pruned });
    if ((s.prev_hash ?? null) !== prev) return fail('prev_hash does not link to the previous scan');
    const pages = all<PageRecord>('SELECT url, status, error FROM scan_pages WHERE scan_id = ?', s.id);
    let h: string;
    if (v === 1) h = evidenceHashV1(s.prev_hash ?? null, { id: s.id, siteId: s.site_id, finishedAt: s.finished_at, pages: pages.map((p) => p.url), fingerprints: all<any>('SELECT DISTINCT fingerprint FROM scan_issues WHERE scan_id = ?', s.id).map((r) => r.fingerprint) });
    else if (v === 2) h = evidenceHashV2(s.prev_hash ?? null, s, pages, all<IssueRecord>('SELECT page_url, rule_id, impact, wcag, help, help_url, target, html, fingerprint FROM scan_issues WHERE scan_id = ?', s.id));
    else return fail(`unknown hash_version ${v}`);
    if (h !== s.evidence_hash) return fail('recomputed hash differs from the stored hash');
    prev = s.evidence_hash;
  }
  return { ok: true, count: scans.length, head: prev, brokenAt: null, versions, pruned };
}
