import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewChange } from '../../src/lib/billing/index.ts';
const start = new Date('2026-10-01T00:00:00Z'), end = new Date('2026-10-31T00:00:00Z'); // 30-day period

test('upgrade halfway through charges half the price difference, immediately', () => {
  const p = previewChange('starter', 'business', start, end, new Date('2026-10-16T00:00:00Z'));
  assert.deepEqual([p.kind, p.effective, p.chargeCents], ['upgrade', 'immediately', 1000]); // (3900-1900)/2
});
test('upgrade at the very start charges the full difference; at the end nothing', () => {
  assert.equal(previewChange('business', 'agency', start, end, start).chargeCents, 6000);
  assert.equal(previewChange('business', 'agency', start, end, end).chargeCents, 0);
  assert.equal(previewChange('business', 'agency', start, end, new Date('2027-01-01')).chargeCents, 0, 'clamped after period end');
});
test('proration rounds to whole cents', () => {
  const p = previewChange('starter', 'agency', start, end, new Date('2026-10-21T00:00:00Z')); // 10/30 of 8000
  assert.equal(p.chargeCents, 2667);
});
test('upgrade from no plan is charged prorated full price', () => {
  assert.equal(previewChange('none', 'starter', start, end, new Date('2026-10-16T00:00:00Z')).chargeCents, 950);
});
test('downgrades apply at period end with no charge', () => {
  const p = previewChange('agency', 'starter', start, end, new Date('2026-10-10T00:00:00Z'));
  assert.deepEqual([p.kind, p.effective, p.chargeCents, p.effectiveAt], ['downgrade', 'period_end', 0, end.toISOString()]);
});
test('same plan is a no-op', () => { assert.equal(previewChange('business', 'business', start, end).kind, 'none'); });

import { verifyPaddleSignature, signPaddle } from '../../src/lib/billing/paddle.ts';
test('Paddle signature: valid, tampered, wrong secret, stale, rotated secrets', () => {
  const raw = '{"event_id":"evt_1"}', ts = 1_800_000_000;
  const h = signPaddle(raw, 'sec', ts);
  assert.ok(verifyPaddleSignature(Buffer.from(raw), h, 'sec', 300, ts + 10));
  assert.ok(!verifyPaddleSignature(Buffer.from(raw + ' '), h, 'sec', 300, ts));
  assert.ok(!verifyPaddleSignature(Buffer.from(raw), h, 'other', 300, ts));
  assert.ok(!verifyPaddleSignature(Buffer.from(raw), h, 'sec', 300, ts + 301), 'replay outside tolerance');
  assert.ok(!verifyPaddleSignature(Buffer.from(raw), 'garbage', 'sec', 300, ts));
  const rotated = `ts=${ts};h1=${'0'.repeat(64)};${h.split(';')[1]}`;
  assert.ok(verifyPaddleSignature(Buffer.from(raw), rotated, 'sec', 300, ts));
});
