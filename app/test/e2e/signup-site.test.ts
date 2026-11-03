import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './helpers.ts';
const { buildServer } = await import('../../src/server.ts');
const db = await import('../../src/db.ts');
const app = await buildServer();
after(() => app.close());
const origin = (body: string) => body.match(/id="origin"[^>]*?value="([^"]*)"/)?.[1] ?? '';

test('free scan → signup?site=… carries the scanned site to the empty dashboard, then clears it', async () => {
  const c = client(app);
  let r = await c.req('GET', '/signup?lang=en&site=' + encodeURIComponent('https://shop.example/some/page?x=1'));
  assert.match(r.body, /After you sign up, https:\/\/shop\.example is ready to add as your first site\./);
  assert.equal(c.jar.get('af_site'), 'https://shop.example');
  r = await c.post('/signup', { email: 'carry@shop.example', password: 'correct horse battery' }, '/signup');
  assert.equal(r.statusCode, 303);
  r = await c.req('GET', '/app');
  assert.equal(origin(r.body), 'https://shop.example'); assert.match(r.body, /id="name"[^>]*value="shop\.example"/);
  assert.match(r.body, /choose a plan<\/a> for scheduled scans/, 'space after the link');
  r = await c.post('/app/sites', { name: 'Shop', origin: 'https://shop.example' });
  assert.equal(r.statusCode, 303); assert.equal(c.jar.has('af_site'), false, 'cookie cleared after the first site is added');
});

test('waitlist site is the fallback; unsafe or junk values are ignored', async () => {
  db.run("INSERT INTO waitlist (email, token, created_at, site) VALUES ('wl@shop.example', 'tok-wl', '2026-01-01', 'https://wl.example')");
  const c = client(app);
  await c.post('/signup', { email: 'wl@shop.example', password: 'correct horse battery' }, '/signup');
  assert.equal(origin((await c.req('GET', '/app')).body), 'https://wl.example');
  const d = client(app);
  let r = await d.req('GET', '/signup?site=' + encodeURIComponent('javascript:alert(1)'));
  assert.equal(d.jar.has('af_site'), false); assert.doesNotMatch(r.body, /ready to add/);
  r = await d.req('GET', '/signup?site=' + encodeURIComponent('"><script>x</script>'));
  assert.doesNotMatch(r.body, /<script>x<\/script>/);
  await d.post('/signup', { email: 'plain@shop.example', password: 'correct horse battery' }, '/signup');
  assert.equal(origin((await d.req('GET', '/app')).body), '');
});
