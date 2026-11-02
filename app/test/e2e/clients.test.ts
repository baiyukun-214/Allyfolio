import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './helpers.ts';
process.env.MAILER = 'console'; process.env.RESEND_API_KEY = '';
let app: any, db: any, report: any;
before(async () => {
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
  report = await import('../../src/lib/report.ts');
});
after(async () => { await app.close(); await (await import('../../src/lib/scanner.ts')).closeBrowser?.(); });
const loc = (r: any) => decodeURIComponent(r.headers.location ?? '');
async function setup(email: string, plan: string) {
  const c = client(app);
  await c.post('/signup', { email, password: 'a very long password' }, '/signup');
  const team = db.get('SELECT m.team_id AS id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = ?', email);
  db.run('UPDATE teams SET plan = ? WHERE id = ?', plan, team.id);
  return { c, team };
}
const site = (id: string, team: string, name: string, origin: string) => db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, verified_at, verify_method, created_at) VALUES (?, ?, ?, ?, 't', '2026-11-01', 'dns', ?)", id, team, name, origin, '2026-11-01T00:00:0' + id.slice(-1) + 'Z');
const scan = (id: string, siteId: string, crit: number, ser: number) => db.run("INSERT INTO scans (id, site_id, kind, status, created_at, finished_at, pages_scanned, page_limit, critical, serious, moderate, minor, evidence_hash) VALUES (?, ?, 'scheduled', 'done', '2026-11-01', '2026-11-01T10:00:00Z', 3, 500, ?, ?, 0, 0, 'h')", id, siteId, crit, ser);

test('agency: create clients, group sites, overview, dashboard filter, site card, PDF names the client, email prefill, export', async () => {
  const { c, team } = await setup('agency@example.com', 'agency');
  site('cs1', team.id, 'Bakery', 'https://bakery.example'); site('cs2', team.id, 'Bakery shop', 'https://shop.bakery.example'); site('cs3', team.id, 'Garage', 'https://garage.example');
  scan('sc1', 'cs1', 1, 2); scan('sc2', 'cs2', 0, 4); scan('sc3', 'cs3', 5, 5);
  let r = await c.req('GET', '/app');
  assert.match(r.body, /<a href="\/app\/clients"[^>]*>Clients<\/a>/, 'nav link');
  assert.doesNotMatch(r.body, /<label for="cf">/, 'no filter until clients exist');
  r = await c.req('GET', '/app/clients'); assert.match(r.body, /No clients yet/);
  assert.match(loc(await c.post('/app/clients', { name: '' }, '/app/clients')), /Enter a client name/);
  assert.match(loc(await c.post('/app/clients', { name: 'Bäckerei Müller', contact_email: 'nope' }, '/app/clients')), /contact email is not valid/);
  r = await c.post('/app/clients', { name: 'Bäckerei Müller', contact_email: 'Inhaber@Baeckerei.example', notes: 'Retainer' }, '/app/clients');
  assert.match(loc(r), /^\/app\/clients\/[\w-]+\?ok=Client added/);
  const bm = db.get("SELECT * FROM clients WHERE name = 'Bäckerei Müller'");
  assert.equal(bm.contact_email, 'inhaber@baeckerei.example');
  assert.match(loc(await c.post('/app/clients', { name: 'Bäckerei Müller' }, '/app/clients')), /already exists/);
  await c.post('/app/clients', { name: 'Autohaus' }, '/app/clients');
  const ah = db.get("SELECT * FROM clients WHERE name = 'Autohaus'");
  const P = `/app/clients/${bm.id}`;
  r = await c.req('GET', P);
  assert.match(r.body, /No sites in this workspace yet/); assert.match(r.body, /<option value="cs1">Bakery \(https:\/\/bakery\.example\)<\/option>/);
  assert.match(loc(await c.post(P + '/sites', { site_id: 'cs1' }, P)), /Site added/);
  await c.post(P + '/sites', { site_id: 'cs2' }, P);
  await c.post(`/app/clients/${ah.id}/sites`, { site_id: 'cs3' }, `/app/clients/${ah.id}`);
  r = await c.req('GET', P);
  assert.match(r.body, /2 sites · 7 critical \+ serious issues in the latest scans · inhaber@baeckerei\.example/);
  assert.match(r.body, /href="\/app\/sites\/cs1\/manual">0 pass · 0 fail · 54 not checked/);
  assert.match(r.body, /aria-label="Remove Bakery shop from this client"/);
  assert.match(r.body, /Garage \(https:\/\/garage\.example\) – currently: Autohaus/);
  r = await c.req('GET', '/app/clients');
  assert.match(r.body, /<a href="\/app\/clients\/[\w-]+">Autohaus<\/a><\/td><td>1<\/td><td>10<\/td>/);
  assert.match(r.body, /Bäckerei Müller<\/a><\/td><td>2<\/td><td>7<\/td>/);
  // Dashboard: client column and filter.
  r = await c.req('GET', '/app');
  assert.match(r.body, /<label for="cf">Show<\/label>/); assert.match(r.body, /<th scope="col">Client<\/th>/);
  r = await c.req('GET', `/app?client=${ah.id}`);
  assert.match(r.body, /Garage/); assert.doesNotMatch(r.body, /bakery\.example/); assert.match(r.body, /3\/15|3 \/ 15|3 of 15/);
  db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, created_at) VALUES ('cs4', ?, 'Loose', 'https://loose.example', 't', '2026-11-02')", team.id);
  r = await c.req('GET', '/app?client=none'); assert.match(r.body, /loose\.example/); assert.doesNotMatch(r.body, /garage\.example/);
  r = await c.req('GET', '/app?client=bogus'); assert.match(r.body, /loose\.example/); assert.match(r.body, /garage\.example/);
  // Site card: move a site between clients.
  r = await c.req('GET', '/app/sites/cs2');
  assert.match(r.body, /<h2 id="sc-h"[^>]*>Client<\/h2>/); assert.match(r.body, new RegExp(`<option value="${bm.id}" selected>Bäckerei Müller</option>`));
  assert.match(loc(await c.post('/app/sites/cs2/client', { client_id: ah.id }, '/app/sites/cs2')), /Client updated/);
  assert.equal(db.get("SELECT client_id FROM sites WHERE id = 'cs2'").client_id, ah.id);
  await c.post('/app/sites/cs2/client', { client_id: '' }, '/app/sites/cs2');
  assert.equal(db.get("SELECT client_id FROM sites WHERE id = 'cs2'").client_id, null);
  await c.post('/app/sites/cs2/client', { client_id: bm.id }, '/app/sites/cs2');
  // PDF HTML names the client; email form suggests the client contact.
  assert.match(report.reportHtml('sc1', { name: 'Allyfolio', color: '#1e3a8a', logoDataUri: null, whiteLabel: false }, 'en'), /Prepared for Bäckerei Müller<\/p>\s*<h1>Bakery<\/h1>/);
  assert.match(report.reportHtml('sc1', { name: 'Allyfolio', color: '#1e3a8a', logoDataUri: null, whiteLabel: false }, 'zh-CN'), /为 Bäckerei Müller 编制/);
  assert.match((await c.req('GET', '/app/sites/cs1/email-reports')).body, /id="send-to" name="recipients" type="text" autocomplete="off" required value="inhaber@baeckerei\.example"/);
  // Edit, remove, delete keeps sites.
  assert.match(loc(await c.post(P, { name: 'Autohaus' }, P)), /already exists/);
  assert.match(loc(await c.post(P, { name: 'Bäckerei Müller GmbH', contact_email: '', notes: '' }, P)), /Client saved/);
  assert.equal(db.get('SELECT name, contact_email FROM clients WHERE id = ?', bm.id).contact_email, null);
  assert.match(loc(await c.post(`${P}/sites/cs2/remove`, {}, P)), /Site removed/);
  assert.equal((await c.post(`${P}/sites/cs3/remove`, {}, P)).statusCode, 404, 'site of another client');
  const exp = JSON.parse((await c.req('GET', '/app/account/export')).body);
  assert.deepEqual(exp.teams[0].clients.map((x: any) => x.name).sort(), ['Autohaus', 'Bäckerei Müller GmbH']);
  assert.equal(exp.teams[0].sites.find((x: any) => x.id === 'cs1').client_id, bm.id);
  assert.match(loc(await c.post(`${P}/delete`, {}, P)), /Client deleted/);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM sites WHERE id IN ('cs1','cs2')").n, 2);
  assert.equal(db.get("SELECT client_id FROM sites WHERE id = 'cs1'").client_id, null);

  // Other team: 404 for everything, cannot attach foreign sites or clients.
  const o = await setup('other@example.com', 'agency');
  site('os1', o.team.id, 'Other', 'https://other.example');
  const A = `/app/clients/${ah.id}`;
  assert.equal((await o.c.req('GET', A)).statusCode, 404);
  for (const [u, f] of [[A, { name: 'x' }], [A + '/sites', { site_id: 'os1' }], [A + '/sites/cs3/remove', {}], [A + '/delete', {}]] as const) assert.equal((await o.c.post(u, f, '/app')).statusCode, 404, u);
  await o.c.post('/app/clients', { name: 'Mine' }, '/app/clients');
  const mine = db.get("SELECT id FROM clients WHERE name = 'Mine'");
  assert.equal((await o.c.post(`/app/clients/${mine.id}/sites`, { site_id: 'cs3' }, '/app')).statusCode, 404, 'foreign site');
  assert.equal((await o.c.post('/app/sites/os1/client', { client_id: ah.id }, '/app')).statusCode, 404, 'foreign client');
  assert.equal(db.get("SELECT client_id FROM sites WHERE id = 'cs3'").client_id, ah.id);
});

test('non-agency plans: no nav link, gate page, no card, grouping kept for later and hidden from the PDF', async () => {
  const { c, team } = await setup('biz@example.com', 'business');
  site('bs1', team.id, 'Shop', 'https://shop.example'); scan('bsc1', 'bs1', 0, 1);
  db.run("INSERT INTO clients (id, team_id, name, created_at) VALUES ('oldc', ?, 'Old client', '2026-10-01')", team.id);
  db.run("UPDATE sites SET client_id = 'oldc' WHERE id = 'bs1'");
  let r = await c.req('GET', '/app');
  assert.doesNotMatch(r.body, /href="\/app\/clients"/); assert.doesNotMatch(r.body, /<th scope="col">Client<\/th>/);
  r = await c.req('GET', '/app/clients'); assert.match(r.body, /Client workspaces are part of the Agency plan/); assert.doesNotMatch(r.body, /Old client/);
  assert.equal((await c.req('GET', '/app/clients/oldc')).statusCode, 303);
  assert.match(loc(await c.post('/app/clients', { name: 'New' }, '/app')), /part of the Agency plan/);
  assert.match(loc(await c.post('/app/sites/bs1/client', { client_id: '' }, '/app')), /part of the Agency plan/);
  assert.doesNotMatch((await c.req('GET', '/app/sites/bs1')).body, /id="sc-h"/);
  assert.doesNotMatch(report.reportHtml('bsc1', { name: 'Allyfolio', color: '#1e3a8a', logoDataUri: null, whiteLabel: false }, 'en'), /Prepared for/);
  assert.equal(db.get("SELECT client_id FROM sites WHERE id = 'bs1'").client_id, 'oldc', 'grouping kept');
  db.run("UPDATE teams SET plan_override = 'agency' WHERE id = ?", team.id);
  assert.match((await c.req('GET', '/app/clients')).body, /Old client/, 'comped agency sees it again');
});
