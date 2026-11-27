import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
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

test('verify-chain --anchor fails when an anchored scan within retention is deleted, allows expired retention', () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-anchor-'));
  const dbPath = join(dir, 'test.db');
  const anchorPath = join(dir, 'anchor.json');
  const runCli = () => {
    try {
      return { code: 0, out: execFileSync(process.execPath, ['--import', 'tsx', 'scripts/verify-chain.ts', '--anchor', anchorPath], { env: { ...process.env, DATABASE_PATH: dbPath }, encoding: 'utf8' }) };
    } catch (e: any) {
      return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
    }
  };
  try {
    const recentAt = new Date(Date.now() - 5 * 86400_000).toISOString();
    const expiredAt = '2020-01-01T00:00:00.000Z';
    const d = new DatabaseSync(dbPath);
    d.exec(`
      CREATE TABLE teams (id TEXT PRIMARY KEY, plan TEXT NOT NULL DEFAULT 'starter', plan_override TEXT);
      CREATE TABLE sites (id TEXT PRIMARY KEY, team_id TEXT NOT NULL);
      CREATE TABLE scans (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, pages_scanned INTEGER NOT NULL DEFAULT 0, page_limit INTEGER, critical INTEGER NOT NULL DEFAULT 0, serious INTEGER NOT NULL DEFAULT 0, moderate INTEGER NOT NULL DEFAULT 0, minor INTEGER NOT NULL DEFAULT 0, new_issues INTEGER, fixed_issues INTEGER, crawl TEXT, prev_hash TEXT, evidence_hash TEXT, hash_version INTEGER);
      CREATE TABLE scan_pages (scan_id TEXT NOT NULL, url TEXT NOT NULL, status INTEGER, error TEXT);
      CREATE TABLE scan_issues (id INTEGER PRIMARY KEY, scan_id TEXT NOT NULL, page_url TEXT NOT NULL, rule_id TEXT NOT NULL, impact TEXT NOT NULL, wcag TEXT, help TEXT NOT NULL, help_url TEXT, target TEXT NOT NULL, html TEXT, fingerprint TEXT NOT NULL);
      CREATE TABLE manual_evidence (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, seq INTEGER NOT NULL, criterion TEXT NOT NULL, status TEXT NOT NULL, notes TEXT, assignee_id TEXT, actor_id TEXT, created_at TEXT NOT NULL, scan_anchor TEXT, prev_hash TEXT, hash TEXT NOT NULL);
    `);
    d.prepare("INSERT INTO teams (id, plan) VALUES ('t1', 'starter')").run();
    d.prepare("INSERT INTO sites (id, team_id) VALUES ('s1', 't1')").run();
    const rec = { id: 'sc1', site_id: 's1', kind: 'manual', finished_at: recentAt, page_limit: 100, pages_scanned: 0, critical: 0, serious: 0, moderate: 0, minor: 0, new_issues: null, fixed_issues: null, crawl: null };
    const h = ev.evidenceHashV2(null, rec, [], []);
    d.prepare("INSERT INTO scans (id, site_id, kind, status, created_at, finished_at, pages_scanned, page_limit, prev_hash, evidence_hash, hash_version) VALUES ('sc1','s1','manual','done',?,?,0,100,NULL,?,2)").run(recentAt, recentAt, h);
    d.close();

    writeFileSync(anchorPath, JSON.stringify({ anchored_at: recentAt, scan_heads: [{ site_id: 's1', scan_id: 'sc1', finished_at: recentAt, evidence_hash: h }], manual_heads: [] }));
    let res = runCli();
    assert.equal(res.code, 0, res.out);

    // Delete anchored scan inside the 12-month retention window -> must FAIL with MISSING
    const d2 = new DatabaseSync(dbPath);
    d2.prepare("DELETE FROM scans WHERE id = 'sc1'").run();
    d2.close();
    res = runCli();
    assert.notEqual(res.code, 0, 'deleting an anchored scan within retention must fail');
    assert.match(res.out, /MISSING/);

    // Anchor pointing to an old scan beyond retention -> allowed (gone)
    writeFileSync(anchorPath, JSON.stringify({ anchored_at: expiredAt, scan_heads: [{ site_id: 's1', scan_id: 'old', finished_at: expiredAt, evidence_hash: 'deadbeef' }], manual_heads: [] }));
    res = runCli();
    assert.equal(res.code, 0, res.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
