import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.SITE_ORIGINS = 'https://allyfolio.com,https://www.allyfolio.com';
process.env.PADDLE_WEBHOOK_SECRET = 'test_webhook_secret_placeholder';
process.env.PADDLE_API_KEY ??= 'test_api_key_placeholder';
process.env.BILLING_PROVIDER = 'paddle';
for (const k of ['STARTER', 'BUSINESS', 'AGENCY', 'ONEOFF']) process.env[`PADDLE_PRICE_${k}`] ??= `pri_test_${k.toLowerCase()}`;
import { fixtureServer } from './helpers.ts';
const { buildServer } = await import('../../src/server.ts');
const { signPaddle } = await import('../../src/lib/billing/paddle.ts');
const { closeBrowser } = await import('../../src/lib/scanner.ts');
after(async () => { await closeBrowser(); });

test('CORS on /api/scan follows SITE_ORIGINS', async () => {
  const app = await buildServer();
  for (const origin of ['https://allyfolio.com', 'https://www.allyfolio.com']) {
    const r = await app.inject({ method: 'OPTIONS', url: '/api/scan', headers: { origin, 'access-control-request-method': 'POST' } });
    assert.equal(r.headers['access-control-allow-origin'], origin);
  }
  const bad = await app.inject({ method: 'OPTIONS', url: '/api/scan', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.notEqual(bad.headers['access-control-allow-origin'], 'https://evil.example');
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
  await app.close();
});

test('Paddle webhook rejects missing/invalid signatures and accepts a valid one', async () => {
  const app = await buildServer();
  const raw = JSON.stringify({ event_id: 'evt_deploy_1', event_type: 'unknown.event', occurred_at: new Date().toISOString(), data: {} });
  const send = (sig?: string) => app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', ...(sig ? { 'paddle-signature': sig } : {}) }, payload: raw });
  assert.equal((await send()).statusCode, 400);
  assert.equal((await send(signPaddle(raw, 'wrong'))).statusCode, 400);
  assert.equal((await send(signPaddle(raw + ' ', 'test_webhook_secret_placeholder'))).statusCode, 400);
  assert.equal((await send(signPaddle(raw, 'test_webhook_secret_placeholder'))).statusCode, 200);
  await app.close();
});

test('free scan API labels the score "Automated checks score" (en) / 自动化检测得分 (zh)', async () => {
  const { server, base } = await fixtureServer({ '/': '<!doctype html><html lang="en"><head><title>t</title></head><body><main><img src="x.png"></main></body></html>' });
  const app = await buildServer();
  for (const [lang, label] of [['en', 'Automated checks score'], ['zh-CN', '自动化检测得分']]) {
    const r = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: base + '/', lang } });
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json();
    assert.equal(j.scoreLabel, label);
    assert.ok(Number.isInteger(j.score) && j.score >= 0 && j.score <= 100);
    assert.match(j.note, /57/);
  }
  await app.close(); server.close();
});
