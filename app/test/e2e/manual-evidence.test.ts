import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './helpers.ts';
let app: any, db: any, mr: any;
before(async () => {
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
  mr = await import('../../src/lib/manualReview.ts');
});
after(async () => { await app.close(); });

test('manual-check evidence: append-only hash chain anchored to the scan chain, shown on the page and in the report, tampering detected', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'ev@example.com', password: 'a very long password' }, '/signup');
  const team = db.get("SELECT t.id FROM teams t JOIN memberships m ON m.team_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = 'ev@example.com'");
  const uid = db.get("SELECT id FROM users WHERE email = 'ev@example.com'").id;
  db.run("UPDATE teams SET plan = 'business' WHERE id = ?", team.id);
  db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, verified_at, verify_method, created_at) VALUES ('ev1', ?, 'Shop', 'https://shop.example', 't', '2026-11-01', 'dns', '2026-11-01')", team.id);
  db.run("INSERT INTO scans (id, site_id, kind, status, created_at, finished_at, pages_scanned, page_limit, evidence_hash) VALUES ('scan-ev', 'ev1', 'scheduled', 'done', '2026-11-01', '2026-11-01T10:00:00Z', 3, 500, 'scanhash1')");

  let r = await c.req('GET', '/app/sites/ev1/manual');
  assert.match(r.body, /<h2 id="ev-h">Evidence log<\/h2>/); assert.match(r.body, /No changes recorded yet/);
  assert.deepEqual(mr.verifyEvidence('ev1'), { ok: true, count: 0, head: null, brokenAt: null });

  await c.post('/app/sites/ev1/manual', { c2_4_7_status: 'fail', c2_4_7_notes: 'No focus ring', c1_1_1_status: 'pass' }, '/app/sites/ev1/manual');
  await c.post('/app/sites/ev1/manual', { c2_4_7_status: 'pass', c2_4_7_notes: 'Fixed in theme 2.3', c1_1_1_status: 'pass' }, '/app/sites/ev1/manual');
  const rows = db.all("SELECT * FROM manual_evidence WHERE site_id = 'ev1' ORDER BY seq");
  assert.equal(rows.length, 3); // unchanged 1.1.1 on the second save adds nothing
  assert.deepEqual(rows.map((x: any) => x.seq), [1, 2, 3]);
  assert.equal(rows[0].prev_hash, null); assert.equal(rows[1].prev_hash, rows[0].hash); assert.equal(rows[2].prev_hash, rows[1].hash);
  assert.ok(rows.every((x: any) => x.scan_anchor === 'scanhash1' && x.actor_id === uid && /^[0-9a-f]{64}$/.test(x.hash)));
  assert.deepEqual([rows[2].criterion, rows[2].status, rows[2].notes], ['2.4.7', 'pass', 'Fixed in theme 2.3']);
  // Old entry still holds the original note: the checklist changes, the log keeps history.
  assert.equal(rows.find((x: any) => x.criterion === '2.4.7' && x.seq < 3).notes, 'No focus ring');
  assert.equal(mr.manualEvidenceHash(rows[2]), rows[2].hash);
  let v = mr.verifyEvidence('ev1'); assert.equal(v.ok, true); assert.equal(v.count, 3); assert.equal(v.head, rows[2].hash);

  r = await c.req('GET', '/app/sites/ev1/manual');
  assert.match(r.body, /Hash chain intact: 3 entries checked/); assert.match(r.body, new RegExp(rows[2].hash)); assert.match(r.body, /Fixed in theme 2\.3/);
  r = await c.req('GET', '/app/scans/scan-ev/report');
  assert.match(r.body, /Manual-check evidence log: 3 entries, hash chain intact/); assert.match(r.body, new RegExp(rows[2].hash));

  // Entries cannot be updated.
  assert.throws(() => db.run("UPDATE manual_evidence SET notes = 'x' WHERE site_id = 'ev1' AND seq = 2"), /append-only/);
  // Simulate tampering outside the app (trigger dropped): the chain no longer verifies.
  db.run('DROP TRIGGER manual_evidence_no_update');
  db.run("UPDATE manual_evidence SET notes = 'Looks fine' WHERE site_id = 'ev1' AND seq = 1");
  v = mr.verifyEvidence('ev1'); assert.equal(v.ok, false); assert.equal(v.brokenAt, 1);
  r = await c.req('GET', '/app/sites/ev1/manual'); assert.match(r.body, /Hash chain broken at entry 1/);
  r = await c.req('GET', '/app/scans/scan-ev/report'); assert.match(r.body, /did not verify/);
  db.run("UPDATE manual_evidence SET notes = ? WHERE site_id = 'ev1' AND seq = 1", rows[0].notes);
  assert.equal(mr.verifyEvidence('ev1').ok, true);
  db.run("DELETE FROM manual_evidence WHERE site_id = 'ev1' AND seq = 2");
  v = mr.verifyEvidence('ev1'); assert.equal(v.ok, false); assert.equal(v.brokenAt, 2);

  // Data export includes the log.
  const exp = JSON.parse((await c.req('GET', '/app/account/export')).body);
  const site = exp.teams.flatMap((t: any) => t.sites).find((s: any) => s.id === 'ev1');
  assert.equal(site.manual_evidence.length, 2);
});
