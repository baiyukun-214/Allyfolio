import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, ONE_OFF, assertCanAddSite, assertCanAddSeat, LimitError, pageCap, canPdf, nextScanAt, retentionCutoff } from '../../src/lib/plans.ts';

test('plan limits match the published pricing', () => {
  const s = PLANS.starter, b = PLANS.business, a = PLANS.agency;
  assert.deepEqual([s.priceCents, s.sites, s.pagesPerSite, s.frequency, s.retentionMonths, s.seats, s.pdf, s.whiteLabel], [1900, 1, 100, 'weekly', 12, 1, false, false]);
  assert.deepEqual([b.priceCents, b.sites, b.pagesPerSite, b.frequency, b.retentionMonths, b.seats, b.pdf, b.whiteLabel], [3900, 3, 500, 'daily', 24, 3, true, false]);
  assert.deepEqual([a.priceCents, a.sites, a.pagesPerSite, a.frequency, a.retentionMonths, a.seats, a.pdf, a.whiteLabel], [9900, 15, 1000, 'daily', 24, 10, true, true]);
  assert.deepEqual([ONE_OFF.priceCents, ONE_OFF.sites, ONE_OFF.pages, ONE_OFF.pdf], [4900, 1, 100, true]);
});
test('site and seat limits enforce at the boundary', () => {
  assert.doesNotThrow(() => assertCanAddSite(PLANS.business, 2));
  assert.throws(() => assertCanAddSite(PLANS.business, 3), LimitError);
  assert.throws(() => assertCanAddSite(PLANS.starter, 1), LimitError);
  assert.doesNotThrow(() => assertCanAddSite(PLANS.agency, 14));
  assert.throws(() => assertCanAddSite(PLANS.agency, 15), LimitError);
  assert.throws(() => assertCanAddSeat(PLANS.starter, 1), LimitError);
  assert.doesNotThrow(() => assertCanAddSeat(PLANS.agency, 9));
  assert.throws(() => assertCanAddSeat(PLANS.agency, 10), LimitError);
});
test('page caps, PDF access, frequency, retention', () => {
  assert.equal(pageCap(PLANS.starter, false), 100); assert.equal(pageCap(PLANS.agency, false), 1000); assert.equal(pageCap(PLANS.none, true), 100);
  assert.equal(canPdf(PLANS.starter, false), false); assert.equal(canPdf(PLANS.starter, true), true); assert.equal(canPdf(PLANS.business, false), true);
  const t = new Date('2026-01-01T00:00:00Z');
  assert.equal(nextScanAt(PLANS.starter, t), '2026-01-08T00:00:00.000Z');
  assert.equal(nextScanAt(PLANS.business, t), '2026-01-02T00:00:00.000Z');
  assert.equal(nextScanAt(PLANS.none, t), null);
  assert.equal(retentionCutoff(PLANS.starter, t), '2025-01-01T00:00:00.000Z');
  assert.equal(retentionCutoff(PLANS.agency, t), '2024-01-01T00:00:00.000Z');
});
