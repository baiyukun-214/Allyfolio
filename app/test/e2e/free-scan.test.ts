import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

process.env.ALLOW_PRIVATE_TARGETS = '1';
process.env.DATABASE_PATH = ':memory:';
process.env.WORKER = '0';
process.env.LOG_LEVEL = 'warn';
const fixture = readFileSync(new URL('../fixtures/bad-page.html', import.meta.url));
let server: http.Server, base = '';
let app: any, closeBrowser: any, sentMail: any[];
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/forbidden') { res.writeHead(403, { 'content-type': 'text/html' }); return res.end('no'); }
    if (req.url === '/redirect') { res.writeHead(302, { location: '/' }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  ({ buildServer: app } = await import('../../src/server.ts'));
  app = await app();
  ({ closeBrowser } = await import('../../src/lib/scanner.ts'));
  ({ sentMail } = await import('../../src/lib/mailer.ts'));
});
after(async () => { await closeBrowser(); await app.close(); server.close(); });

test('POST /api/scan scans a local fixture and summarises by impact with WCAG refs', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: base + '/redirect' } });
  assert.equal(res.statusCode, 200, res.body);
  const j = res.json();
  assert.ok(j.total >= 3, 'expected several issues');
  const rules = j.byImpact.flatMap((g: any) => g.rules.map((r: any) => r.ruleId));
  for (const r of ['image-alt', 'label', 'color-contrast']) assert.ok(rules.includes(r), `missing ${r}: ${rules}`);
  const img = j.byImpact.flatMap((g: any) => g.rules).find((r: any) => r.ruleId === 'image-alt');
  assert.ok(img.wcag.some((w: string) => w.startsWith('WCAG 1.1.1')), JSON.stringify(img.wcag));
  assert.match(j.note, /57%/);
});
test('POST /api/scan rejects invalid input', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: 'ftp://x.example' } });
  assert.equal(res.statusCode, 400);
});
test('waitlist double opt-in grants early bird', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/waitlist', payload: { email: 'Ann@Example.com' } });
  assert.equal(r.statusCode, 200, r.body);
  const mail = sentMail.at(-1); assert.equal(mail.to, 'ann@example.com');
  const link = mail.text.match(/\/api\/waitlist\/confirm\?token=\S+/)[0];
  const c = await app.inject({ method: 'GET', url: link });
  assert.equal(c.statusCode, 200); assert.match(c.body, /30% off/);
});

test('POST /api/scan returns error codes with localized messages', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: 'ftp://x.example' } });
  assert.equal(bad.json().code, 'invalid_url'); assert.match(bad.json().error, /https:\/\//);
  const r = await app.inject({ method: 'POST', url: '/api/scan', headers: { 'accept-language': 'zh-CN' }, payload: { url: base + '/forbidden' } });
  assert.equal(r.statusCode, 422, r.body);
  assert.equal(r.json().code, 'blocked'); assert.match(r.json().error, /海外/);
});
test('rate limit returns rate_limited with retry time', async () => {
  let last: any;
  for (let i = 0; i < 8; i++) { last = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: base + '/forbidden' } }); if (last.statusCode === 429) break; }
  assert.equal(last.statusCode, 429);
  const j = last.json(); assert.equal(j.code, 'rate_limited'); assert.ok(j.retryAfterS > 0);
  assert.ok(last.headers['retry-after']); assert.match(j.error, /minute/);
});
