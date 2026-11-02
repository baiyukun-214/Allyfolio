// Read-only: recompute every site's scan evidence chain (and manual-check chain) and print the result.
// npm run verify-chain [-- <siteId>]   Exit code 1 if any chain does not verify.
import { all } from '../src/db.ts';
import { verifyScanChain } from '../src/lib/evidence.ts';
import { verifyEvidence } from '../src/lib/manualReview.ts';
const only = process.argv[2];
const sites = all<any>('SELECT id FROM sites' + (only ? ' WHERE id = ?' : ''), ...(only ? [only] : []));
let bad = 0;
for (const s of sites) {
  const sc = verifyScanChain(s.id), mc = verifyEvidence(s.id);
  if (!sc.ok || !mc.ok) bad++;
  console.log(JSON.stringify({ site: s.id, scans: { ok: sc.ok, count: sc.count, versions: sc.versions, head: sc.head, brokenAt: sc.brokenAt, reason: sc.reason }, manual: { ok: mc.ok, count: mc.count, brokenAt: mc.brokenAt } }));
}
console.log(bad ? `FAIL: ${bad} site(s) with a broken chain` : `OK: ${sites.length} site(s) verified`);
process.exitCode = bad ? 1 : 0;
