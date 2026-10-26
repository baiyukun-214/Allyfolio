import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
process.env.ALLOW_PRIVATE_TARGETS = '1';
process.env.DATABASE_PATH = ':memory:';
process.env.WORKER = '0';
process.env.LOG_LEVEL = 'warn';
process.env.FREE_SCAN_MAX_QUEUE = '0'; // every request finds the queue "full"
let app: any;
before(async () => { const { buildServer } = await import('../../src/server.ts'); app = await buildServer(); });
after(async () => { await app.close(); });
test('full queue returns 503 busy with a calm localized message and retry time', async () => {
  for (const [lang, re] of [['en', /busy with other scans.*try again in about/], ['zh-CN', /正忙.*后再试/]] as const) {
    const r = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: 'http://127.0.0.1:9/', lang } });
    assert.equal(r.statusCode, 503, r.body);
    const j = r.json(); assert.equal(j.code, 'busy'); assert.match(j.error, re); assert.ok(j.retryAfterS >= 15); assert.ok(r.headers['retry-after']);
  }
});
