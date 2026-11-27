import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureServer, client } from './helpers.ts';
let app: any, fx: any, run: any, sentMail: any[];
const TOKEN_HOLDER = { token: '' };
before(async () => {
  fx = await fixtureServer({ '/': (_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><head><meta name="allyfolio-verification" content="${TOKEN_HOLDER.token}"></head><body>hi</body></html>`); } });
  app = await (await import('../../src/server.ts')).buildServer();
  ({ run } = await import('../../src/db.ts'));
  ({ sentMail } = await import('../../src/lib/mailer.ts'));
});
after(async () => { await app.close(); fx.server.close(); });

test('signup, add + verify site, site limit, seat limit, CSRF', async () => {
  const c = client(app);
  let r = await c.post('/signup', { email: 'owner@example.com', password: 'correct horse battery' }, '/signup');
  assert.equal(r.statusCode, 303); assert.equal(r.headers.location, '/app');
  r = await c.req('POST', '/app/sites', { name: 'x', origin: fx.base });
  assert.equal(r.statusCode, 403, 'missing CSRF must be rejected');
  r = await c.post('/app/sites', { name: 'Fixture', origin: fx.base });
  assert.equal(r.statusCode, 303); const sitePath = r.headers.location as string;
  const page = await c.req('GET', sitePath);
  TOKEN_HOLDER.token = page.body.match(/content="([0-9a-f]{32})"/)![1];
  r = await c.post(sitePath + '/verify', {}, sitePath);
  assert.match(decodeURIComponent(r.headers.location as string), /Ownership verified/);
  r = await c.post('/app/sites', { name: 'Second', origin: 'https://second.example.com' });
  assert.match(decodeURIComponent(r.headers.location as string), /includes 1 site/);
  r = await c.post('/app/team/invite', { email: 'b@example.com' }, '/app/team');
  assert.match(decodeURIComponent(r.headers.location as string), /includes 1 seat/);
  run("UPDATE teams SET plan = 'business'");
  r = await c.post('/app/team/invite', { email: 'b@example.com' }, '/app/team');
  assert.match(decodeURIComponent(r.headers.location as string), /Invite sent/);
  // invitee accepts via magic link login
  const invite = sentMail.at(-1).text.match(/\/invite\/\S+/)[0];
  const b = client(app);
  await b.post('/login/link', { email: 'b@example.com' }, '/login');
  const link = sentMail.at(-1).text.match(/\/login\/callback\?token=\S+/)[0];
  r = await b.req('GET', link); assert.equal(r.headers.location, '/app');
  r = await b.req('GET', invite); assert.equal(r.statusCode, 303);
  r = await b.req('GET', '/app'); assert.match(r.body, /Fixture/);
  // other users cannot see the site
  const x = client(app); await x.post('/signup', { email: 'x@example.com', password: 'another long password' }, '/signup');
  r = await x.req('GET', sitePath); assert.equal(r.statusCode, 404);
});
test('wrong password is rejected', async () => {
  const c = client(app);
  const r = await c.post('/login', { email: 'owner@example.com', password: 'wrong password!!' }, '/login');
  assert.equal(r.statusCode, 400);
});

test('logged-out team invite preserves next across login and lands on /invite/:token', async () => {
  const owner = client(app);
  await owner.post('/login', { email: 'owner@example.com', password: 'correct horse battery' }, '/login');
  let r = await owner.post('/app/team/invite', { email: 'late@example.com' }, '/app/team');
  assert.match(decodeURIComponent(r.headers.location as string), /Invite sent/);
  const invitePath = new URL(sentMail.at(-1).text.match(/https?:\/\/\S+\/invite\/\S+/)[0]).pathname;

  const inv = client(app);
  await inv.post('/signup', { email: 'late@example.com', password: 'another long password' }, '/signup');
  await inv.post('/logout', {}, '/app');

  // Click invite while logged out -> /login?next=... -> login -> redirected straight to /invite/:token -> /app with team site
  r = await inv.req('GET', invitePath);
  assert.equal(r.statusCode, 302);
  assert.match(r.headers.location as string, /^\/login\?next=%2Finvite%2F/);
  r = await inv.req('GET', r.headers.location as string);
  assert.equal(r.statusCode, 200);
  r = await inv.post('/login', { email: 'late@example.com', password: 'another long password' }, '/login');
  assert.equal(r.statusCode, 303);
  assert.equal(r.headers.location, invitePath);
  r = await inv.req('GET', invitePath);
  assert.equal(r.statusCode, 303);
  assert.equal(r.headers.location, '/app');
  r = await inv.req('GET', '/app');
  assert.match(r.body, /Fixture/);
});
