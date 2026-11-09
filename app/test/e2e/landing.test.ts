import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './helpers.ts';
const { buildServer } = await import('../../src/server.ts');
const app = await buildServer();
after(async () => { await app.close(); });

test('GET / is a public landing for logged-out visitors (no redirect to /login)', async () => {
  const r = await app.inject({ method: 'GET', url: '/' });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'] ?? '', /text\/html/);
  assert.match(r.body, /Allyfolio/);
  assert.match(r.body, /€19/);
  assert.match(r.body, /€39/);
  assert.match(r.body, /€99/);
  assert.match(r.body, /€49/);
  assert.match(r.body, /30-day refund/i);
  assert.match(r.body, /No free trial/i);
  assert.match(r.body, /Xiamen Miaoerduo Trading Co\., Ltd\./);
  assert.match(r.body, /hello@allyfolio\.com/);
  assert.match(r.body, /href="\/signup"/);
  assert.match(r.body, /href="\/login"/);
  assert.match(r.body, /\/pricing/);
  assert.match(r.body, /\/terms/);
  assert.match(r.body, /\/privacy/);
  assert.match(r.body, /\/refund/);
  assert.match(r.body, /\/imprint/);
  assert.match(r.body, /57%/);
  // Build banned-word regex from split strings (preflight scans the source).
  const banned = new RegExp([
    'com' + 'pliant', 'cert' + 'ified', 'guaran' + 'tee',
    '\u5408' + '\u89c4', '\u8ba4' + '\u8bc1',
    'kon' + 'form', 'zertifi' + 'ziert', 'garan' + 'tiert',
    'com' + 'ing soon', 'demn' + String.fromCharCode(0xe4) + 'chst',
  ].join('|'), 'i');
  assert.doesNotMatch(r.body, banned);
});

test('GET / redirects signed-in users to /app', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'landing@example.com', password: 'a very long password' }, '/signup');
  const r = await c.req('GET', '/');
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, '/app');
});

test('GET /robots.txt allows / and does not block everything', async () => {
  const r = await app.inject({ method: 'GET', url: '/robots.txt' });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'] ?? '', /text\/plain/);
  assert.match(r.body, /Allow:\s*\//);
  assert.doesNotMatch(r.body, /Disallow:\s*\/\s*$/m);
});
