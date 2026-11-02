import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureServer, client } from './helpers.ts';
let app: any, fx: any, db: any;
before(async () => {
  // A third-party site with no verification token anywhere.
  fx = await fixtureServer({ '/': '<!doctype html><html lang="en"><head><title>x</title></head><body><main><h1>Other</h1></main></body></html>' });
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
});
after(async () => { await app.close(); fx.server.close(); });

test('verify_bypass defaults to 0: unverified third-party site stays unverified', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'normal@example.com', password: 'a very long password' }, '/signup');
  const team = db.get("SELECT t.* FROM teams t JOIN memberships m ON m.team_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = 'normal@example.com'");
  assert.equal(team.verify_bypass, 0);
  db.run("UPDATE teams SET plan = 'agency' WHERE id = ?", team.id);
  const r = await c.post('/app/sites', { name: 'Other', origin: fx.base });
  const sitePath = r.headers.location as string;
  await c.post(sitePath + '/verify', {}, sitePath);
  const site = db.get('SELECT * FROM sites WHERE team_id = ?', team.id);
  assert.equal(site.verified_at, null);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM jobs WHERE json_extract(payload, '$.siteId') = ?", site.id).n, 0);
  // No UI exposes the flag.
  for (const p of ['/app', '/app/team', '/app/settings', sitePath]) assert.doesNotMatch((await c.req('GET', p)).body, /verify_bypass|bypass/i);
});

test('verify_bypass = 1: new site is verified (admin) and first scan is queued; verify button also honours it', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'admin-demo@example.com', password: 'a very long password' }, '/signup');
  const team = db.get("SELECT t.* FROM teams t JOIN memberships m ON m.team_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = 'admin-demo@example.com'");
  // A site added before the flag was set:
  db.run("UPDATE teams SET plan = 'agency' WHERE id = ?", team.id);
  const r0 = await c.post('/app/sites', { name: 'Before', origin: fx.base });
  db.run('UPDATE teams SET verify_bypass = 1 WHERE id = ?', team.id);
  await c.post((r0.headers.location as string) + '/verify', {}, r0.headers.location as string);
  const before = db.get('SELECT * FROM sites WHERE team_id = ? AND name = ?', team.id, 'Before');
  assert.ok(before.verified_at); assert.equal(before.verify_method, 'admin');
  db.run('DELETE FROM sites WHERE id = ?', before.id); db.run('DELETE FROM jobs');
  const r = await c.post('/app/sites', { name: 'Demo', origin: fx.base });
  const site = db.get('SELECT * FROM sites WHERE team_id = ?', team.id);
  assert.ok(site.verified_at); assert.equal(site.verify_method, 'admin'); assert.ok(site.next_scan_at);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM jobs WHERE type = 'site_scan' AND json_extract(payload, '$.siteId') = ?", site.id).n, 1);
  assert.match((await c.req('GET', r.headers.location as string)).body, /Verification waived \(admin\)/);
});
