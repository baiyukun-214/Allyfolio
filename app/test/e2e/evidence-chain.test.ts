import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
let db: any, ev: any;
before(async () => { db = await import('../../src/db.ts'); ev = await import('../../src/lib/evidence.ts'); });

const issue = (n: number) => ({ page_url: `https://shop.example/p${n}`, rule_id: 'image-alt', impact: 'critical', wcag: '1.1.1', help: 'Images must have alternate text', help_url: 'https://dequeuniversity.com/rules/axe/4.10/image-alt', target: `img:nth-child(${n})`, html: `<img src="${n}.png">`, fingerprint: `fp${n}` });

test('scan evidence chain: v1 records stay verifiable, v2 covers every issue field, versions mix in one chain', () => {
  db.run("INSERT INTO teams (id, name, created_at) VALUES ('tc', 'T', '2026-11-01')");
  db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, verified_at, verify_method, created_at) VALUES ('ec1', 'tc', 'Shop', 'https://shop.example', 't', '2026-11-01', 'dns', '2026-11-01')");
  // an old v1 scan exactly as written before hash versioning (hash_version NULL)
  const v1 = ev.evidenceHashV1(null, { id: 'old1', siteId: 'ec1', finishedAt: '2026-10-01T10:00:00Z', pages: ['https://shop.example/p1'], fingerprints: ['fp1'] });
  db.run("INSERT INTO scans (id, site_id, kind, status, created_at, finished_at, pages_scanned, page_limit, critical, prev_hash, evidence_hash) VALUES ('old1','ec1','scheduled','running','2026-10-01','2026-10-01T10:00:00Z',1,100,1,NULL,?)", v1);
  db.run("INSERT INTO scan_pages (scan_id, url, status) VALUES ('old1','https://shop.example/p1',200)");
  const i1 = issue(1);
  db.run('INSERT INTO scan_issues (scan_id, page_url, rule_id, impact, wcag, help, help_url, target, html, fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?)', 'old1', ...Object.values(i1));
  db.run("UPDATE scans SET status='done' WHERE id='old1'");
  let r = ev.verifyScanChain('ec1');
  assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.versions, { v1: 1 }); assert.equal(r.head, v1);

  // a new v2 scan chained onto it
  const rec = { id: 'new2', site_id: 'ec1', kind: 'manual', finished_at: '2026-11-01T10:00:00Z', page_limit: 100, pages_scanned: 2, critical: 2, serious: 0, moderate: 0, minor: 0, new_issues: 1, fixed_issues: 0, crawl: '{"robots":"none"}' };
  const pages = [{ url: 'https://shop.example/p1', status: 200, error: null }, { url: 'https://shop.example/p2', status: 200, error: null }];
  const issues = [issue(1), issue(2)];
  const v2 = ev.evidenceHashV2(v1, rec, pages, issues);
  assert.equal(ev.evidenceHashV2(v1, rec, [...pages].reverse(), [...issues].reverse()), v2, 'row order does not matter');
  db.run("INSERT INTO scans (id, site_id, kind, status, created_at, finished_at, pages_scanned, page_limit, critical, new_issues, fixed_issues, crawl, prev_hash, evidence_hash, hash_version) VALUES ('new2','ec1','manual','done','2026-11-01','2026-11-01T10:00:00Z',2,100,2,1,0,'{\"robots\":\"none\"}',?,?,2)", v1, v2);
  for (const p of pages) db.run('INSERT INTO scan_pages (scan_id, url, status, error) VALUES (?,?,?,?)', 'new2', p.url, p.status, p.error);
  for (const i of issues) db.run('INSERT INTO scan_issues (scan_id, page_url, rule_id, impact, wcag, help, help_url, target, html, fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?)', 'new2', ...Object.values(i));
  r = ev.verifyScanChain('ec1');
  assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.versions, { v1: 1, v2: 1 }); assert.equal(r.head, v2);

  // the app cannot edit stored issues or finished scans
  assert.throws(() => db.run("UPDATE scan_issues SET html = 'x' WHERE scan_id = 'new2'"), /immutable/);
  assert.throws(() => db.run("UPDATE scans SET critical = 0 WHERE id = 'new2'"), /immutable/);

  // with the triggers removed (as a DB admin could), changing ANY issue field of a v2 scan is detected
  db.run('DROP TRIGGER issues_no_update'); db.run('DROP TRIGGER scans_no_update_done');
  for (const col of ['page_url', 'rule_id', 'impact', 'wcag', 'help', 'help_url', 'target', 'html', 'fingerprint']) {
    const id = db.get("SELECT id FROM scan_issues WHERE scan_id = 'new2' ORDER BY id LIMIT 1").id, old = db.get(`SELECT ${col} AS v FROM scan_issues WHERE id = ?`, id).v;
    db.run(`UPDATE scan_issues SET ${col} = ? WHERE id = ?`, col === 'impact' ? 'minor' : old + 'x', id);
    r = ev.verifyScanChain('ec1');
    assert.equal(r.ok, false, `${col} change detected`); assert.equal(r.brokenAt, 'new2');
    db.run(`UPDATE scan_issues SET ${col} = ? WHERE id = ?`, old, id);
    assert.equal(ev.verifyScanChain('ec1').ok, true, `${col} restored`);
  }
  // scan-level fields and deleted / added issue rows
  db.run("UPDATE scans SET critical = 1 WHERE id = 'new2'"); assert.equal(ev.verifyScanChain('ec1').ok, false); db.run("UPDATE scans SET critical = 2 WHERE id = 'new2'");
  db.run("UPDATE scan_pages SET status = 500 WHERE scan_id = 'new2' AND url LIKE '%p2'"); assert.equal(ev.verifyScanChain('ec1').ok, false); db.run("UPDATE scan_pages SET status = 200 WHERE scan_id = 'new2'");
  db.run("DELETE FROM scan_issues WHERE scan_id = 'new2' AND fingerprint = 'fp2'"); assert.equal(ev.verifyScanChain('ec1').ok, false);
  db.run('INSERT INTO scan_issues (scan_id, page_url, rule_id, impact, wcag, help, help_url, target, html, fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?)', 'new2', ...Object.values(issue(2)));
  assert.equal(ev.verifyScanChain('ec1').ok, true);
  // a broken link in the chain (rewritten old record) is reported at the first bad scan
  db.run("UPDATE scans SET finished_at = '2026-10-01T10:00:01Z' WHERE id = 'old1'");
  r = ev.verifyScanChain('ec1'); assert.equal(r.ok, false); assert.equal(r.brokenAt, 'old1');
  // retention removes the oldest scan: the rest still verifies and is flagged as pruned
  db.run("DELETE FROM scans WHERE id = 'old1'");
  r = ev.verifyScanChain('ec1'); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.pruned, true); assert.deepEqual(r.versions, { v2: 1 });
});
