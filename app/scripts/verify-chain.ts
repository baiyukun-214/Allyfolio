// Read-only: recompute every site's scan evidence chain (and manual-check chain) and print the result.
//   npm run verify-chain [-- <siteId>]                 verify the chains in the database
//   npm run verify-chain -- --anchor <anchor.json>     also check that every head in a daily anchor (deploy/anchor.sh)
//                                                      is still present in the database and inside a verifying chain
// Exit code 1 if anything does not verify. Retention may legitimately remove anchored scans older than the plan's history.
import { readFileSync } from 'node:fs';
import { all, get } from '../src/db.ts';
import { verifyScanChain } from '../src/lib/evidence.ts';
import { verifyEvidence } from '../src/lib/manualReview.ts';
const args = process.argv.slice(2), ai = args.indexOf('--anchor');
const anchorFile = ai >= 0 ? args.splice(ai, 2)[1] : null, only = args[0];
const sites = all<any>('SELECT id FROM sites' + (only ? ' WHERE id = ?' : ''), ...(only ? [only] : []));
let bad = 0;
for (const s of sites) {
  const sc = verifyScanChain(s.id), mc = verifyEvidence(s.id);
  if (!sc.ok || !mc.ok) bad++;
  console.log(JSON.stringify({ site: s.id, scans: { ok: sc.ok, count: sc.count, versions: sc.versions, pruned: sc.pruned, head: sc.head, brokenAt: sc.brokenAt, reason: sc.reason }, manual: { ok: mc.ok, count: mc.count, brokenAt: mc.brokenAt } }));
}
if (anchorFile) {
  const a = JSON.parse(readFileSync(anchorFile, 'utf8'));
  let ok = 0, gone = 0, mismatch = 0;
  for (const h of a.scan_heads ?? []) {
    const row = get<any>('SELECT evidence_hash FROM scans WHERE id = ? AND site_id = ?', h.scan_id, h.site_id);
    if (!row) { gone++; console.log(JSON.stringify({ anchor: a.anchored_at, site: h.site_id, scan: h.scan_id, result: 'scan no longer stored (retention or site deleted?)' })); continue; }
    if (row.evidence_hash !== h.evidence_hash) { mismatch++; console.log(JSON.stringify({ anchor: a.anchored_at, site: h.site_id, scan: h.scan_id, result: 'MISMATCH: stored hash differs from anchor' })); continue; }
    ok++;
  }
  for (const h of a.manual_heads ?? []) {
    const row = get<any>('SELECT hash FROM manual_evidence WHERE site_id = ? AND seq = ?', h.site_id, h.seq);
    if (row && row.hash !== h.hash) { mismatch++; console.log(JSON.stringify({ anchor: a.anchored_at, site: h.site_id, seq: h.seq, result: 'MISMATCH: manual evidence entry differs from anchor' })); }
    else if (row) ok++; else gone++;
  }
  if (mismatch) bad++;
  console.log(`anchor ${a.anchored_at}: ${ok} head(s) match, ${gone} no longer stored, ${mismatch} mismatch(es)`);
}
console.log(bad ? `FAIL: ${bad} problem(s)` : `OK: ${sites.length} site(s) verified`);
process.exitCode = bad ? 1 : 0;
