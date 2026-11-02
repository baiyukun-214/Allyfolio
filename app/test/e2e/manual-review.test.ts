import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './helpers.ts';
let app: any, db: any, CRITERIA: any[];
before(async () => {
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
  ({ CRITERIA } = await import('../../src/lib/manualReview.ts'));
});
after(async () => { await app.close(); });

test('manual review checklist: site view summary, edit page, last checked by/when, validation, team isolation, report section', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'reviewer@example.com', password: 'a very long password' }, '/signup');
  const team = db.get("SELECT t.id FROM teams t JOIN memberships m ON m.team_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = 'reviewer@example.com'");
  const uid = db.get("SELECT id FROM users WHERE email = 'reviewer@example.com'").id;
  db.run("UPDATE teams SET plan = 'business' WHERE id = ?", team.id);
  db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, verified_at, verify_method, created_at) VALUES ('mr1', ?, 'Shop', 'https://shop.example', 't', '2026-11-01', 'dns', '2026-11-01')", team.id);
  db.run("INSERT INTO scans (id, site_id, kind, status, created_at, finished_at, pages_scanned, page_limit, evidence_hash) VALUES ('scan-mr', 'mr1', 'scheduled', 'done', '2026-11-01', '2026-11-01T10:00:00Z', 3, 500, 'abc')");

  // Site view: summary with everything not checked.
  let r = await c.req('GET', '/app/sites/mr1');
  assert.match(r.body, /<h2 id="manual-h"[^>]*>Manual review<\/h2>/);
  assert.match(r.body, new RegExp(`0 pass · 0 fail · 0 not applicable · ${CRITERIA.length} not checked`));
  assert.match(r.body, /href="\/app\/sites\/mr1\/manual"/);

  // Checklist page: every criterion with labelled controls.
  r = await c.req('GET', '/app/sites/mr1/manual');
  assert.equal(r.statusCode, 200);
  assert.ok(CRITERIA.length >= 50 && CRITERIA.every((x: any) => ['A', 'AA'].includes(x.level)));
  assert.equal((r.body.match(/<select name="c[\d_]+_status"/g) ?? []).length, CRITERIA.length);
  assert.match(r.body, /aria-label="Status for 2\.4\.7"/); assert.match(r.body, /aria-label="Notes for 2\.4\.7"/);
  assert.match(r.body, /not an accessibility audit or legal assessment/);

  // Save: status + notes + assignee; bogus status and non-member assignee are ignored.
  r = await c.post('/app/sites/mr1/manual', { c2_4_7_status: 'fail', c2_4_7_notes: 'Focus ring missing on <nav> links', c2_4_7_assignee: uid,
    c1_1_1_status: 'pass', c1_1_1_assignee: 'not-a-member', c1_2_2_status: 'na', c3_3_1_status: 'bogus' }, '/app/sites/mr1/manual');
  assert.equal(r.statusCode, 303); assert.match(decodeURIComponent(r.headers.location), /Saved 3 changes/);
  let row = db.get("SELECT * FROM manual_checks WHERE site_id = 'mr1' AND criterion = '2.4.7'");
  assert.deepEqual([row.status, row.notes, row.assignee_id, row.checked_by], ['fail', 'Focus ring missing on <nav> links', uid, uid]);
  assert.ok(row.checked_at);
  assert.equal(db.get("SELECT assignee_id FROM manual_checks WHERE criterion = '1.1.1'").assignee_id, null);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM manual_checks WHERE criterion = '3.3.1'").n, 0);

  // Changing only the assignee keeps last-checked; re-saving identical values is a no-op.
  db.run("UPDATE manual_checks SET checked_at = '2026-10-01T00:00:00Z' WHERE criterion = '2.4.7'");
  await c.post('/app/sites/mr1/manual', { c2_4_7_status: 'fail', c2_4_7_notes: 'Focus ring missing on <nav> links', c2_4_7_assignee: '' }, '/app/sites/mr1/manual');
  row = db.get("SELECT * FROM manual_checks WHERE criterion = '2.4.7'");
  assert.equal(row.assignee_id, null); assert.equal(row.checked_at, '2026-10-01T00:00:00Z');
  r = await c.post('/app/sites/mr1/manual', { c2_4_7_status: 'fail', c2_4_7_notes: 'Focus ring missing on <nav> links' }, '/app/sites/mr1/manual');
  assert.match(decodeURIComponent(r.headers.location), /No changes to save/);

  // Page and site view reflect it; notes are escaped.
  r = await c.req('GET', '/app/sites/mr1/manual');
  assert.match(r.body, /<option value="fail" selected>Fail<\/option>/); assert.match(r.body, /Focus ring missing on &lt;nav&gt; links/); assert.match(r.body, /by reviewer@example\.com/);
  r = await c.req('GET', '/app/sites/mr1');
  assert.match(r.body, /1 pass · 1 fail · 1 not applicable/); assert.match(r.body, /Marked as fail:<\/strong> 2\.4\.7/);

  // Report (printable source of the PDF) has a Manual review section listing recorded criteria only.
  r = await c.req('GET', '/app/scans/scan-mr/report');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /<h2>Manual review<\/h2>/); assert.match(r.body, /2\.4\.7 Focus Visible/); assert.match(r.body, /These entries are not checked by Allyfolio/);
  assert.doesNotMatch(r.body, /3\.3\.1 Error Identification/);
  // zh-CN copy
  db.run("UPDATE users SET locale = 'zh-CN' WHERE id = ?", uid);
  r = await c.req('GET', '/app/sites/mr1/manual'); assert.match(r.body, /人工审查/); assert.match(r.body, /焦点可见/);
  db.run("UPDATE users SET locale = 'en' WHERE id = ?", uid);

  // Another team cannot read or write it.
  const o = client(app);
  await o.post('/signup', { email: 'other@example.com', password: 'another long password' }, '/signup');
  assert.equal((await o.req('GET', '/app/sites/mr1/manual')).statusCode, 404);
  assert.equal((await o.post('/app/sites/mr1/manual', { c2_4_7_status: 'pass' })).statusCode, 404);
  assert.equal(db.get("SELECT status FROM manual_checks WHERE criterion = '2.4.7'").status, 'fail');

  // Unverified sites have no checklist.
  db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, created_at) VALUES ('mr2', ?, 'New', 'https://new.example', 't', '2026-11-01')", team.id);
  assert.equal((await c.req('GET', '/app/sites/mr2/manual')).statusCode, 303);
  // Deleting the site removes its checklist.
  db.run("DELETE FROM sites WHERE id = 'mr1'");
  assert.equal(db.get("SELECT COUNT(*) AS n FROM manual_checks WHERE site_id = 'mr1'").n, 0);
});
