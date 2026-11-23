import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvedRefundAmount, cumulativeCovers, decideRefundIsFull, isApprovedRefundOrChargeback, isTypedFull,
  mergeRefunds, moneyFromTotals, parseMinorUnits, refundAmountFromAdjustment,
} from '../../src/lib/billing/refundCoverage.ts';

const eur = (id: string, amount: string) => ({ id, amount: BigInt(amount), currency: 'EUR' });
const total = { amount: 1900n, currency: 'EUR' };
const approvedPartial = (over: any = {}) => ({
  id: 'adj_1', action: 'refund', status: 'approved', type: 'partial', transaction_id: 'txn_1',
  currency_code: 'EUR', totals: { total: '1900', grand_total: '1900' },
  items: [{ item_id: 'txnitm_1', type: 'partial', amount: '1900' }], ...over,
});

test('type=full is always treated as a full refund when approved', () => {
  const d = approvedPartial({ type: 'full', items: [{ item_id: 'txnitm_1', type: 'full', amount: '1900' }] });
  assert.equal(isApprovedRefundOrChargeback(d), true);
  assert.equal(isTypedFull(d), true);
  assert.equal(decideRefundIsFull({ approved: true, typedFull: true, thisRefund: eur('adj_1', '1900'), storedTotal: total }), true);
});

test('type=partial with amount equal to the tax-inclusive total is a full refund', () => {
  const d = approvedPartial();
  assert.equal(isTypedFull(d), false);
  assert.deepEqual(refundAmountFromAdjustment(d), { amount: 1900n, currency: 'EUR' });
  assert.equal(decideRefundIsFull({
    approved: true, typedFull: false, thisRefund: approvedRefundAmount(d),
    storedTotal: total,
  }), true);
});

test('several partial refunds that add up to the total are a full refund', () => {
  assert.equal(decideRefundIsFull({
    approved: true, typedFull: false, thisRefund: eur('adj_b', '900'),
    storedRefunds: [eur('adj_a', '1000')],
    storedTotal: total,
  }), true);
  // out of order: only the first slice so far does not cover
  assert.equal(decideRefundIsFull({
    approved: true, typedFull: false, thisRefund: eur('adj_b', '900'),
    storedRefunds: [],
    storedTotal: total,
  }), false);
});

test('a genuine partial refund does not revoke', () => {
  assert.equal(decideRefundIsFull({
    approved: true, typedFull: false, thisRefund: eur('adj_p', '1000'),
    storedTotal: total,
  }), false);
});

test('pending_approval and rejected adjustments are not processed', () => {
  const pending = approvedPartial({ status: 'pending_approval' });
  const rejected = approvedPartial({ status: 'rejected' });
  assert.equal(isApprovedRefundOrChargeback(pending), false);
  assert.equal(isApprovedRefundOrChargeback(rejected), false);
  assert.equal(approvedRefundAmount(pending), null);
  assert.equal(approvedRefundAmount(rejected), null);
  assert.equal(decideRefundIsFull({ approved: false, typedFull: true, thisRefund: eur('adj_1', '1900'), storedTotal: total }), false);
  assert.equal(decideRefundIsFull({ approved: false, typedFull: false, thisRefund: eur('adj_1', '1900'), storedTotal: total }), false);
});

test('duplicate / already-stored amounts are merged by adjustment id and still cover once', () => {
  const a = eur('adj_a', '1000');
  const b = eur('adj_b', '900');
  const merged = mergeRefunds([a], [a, b], [b]);
  assert.equal(merged.length, 2);
  assert.equal(cumulativeCovers(merged, total), true);
  // same notification replayed: still one of each, still covers
  assert.equal(decideRefundIsFull({
    approved: true, typedFull: false, thisRefund: b,
    storedRefunds: [a, b],
    fetchedRefunds: [a, b],
    storedTotal: total,
    fetchedTotal: total,
  }), true);
});

test('currency must match; missing totals fail safe; only approved amounts count', () => {
  assert.equal(decideRefundIsFull({
    approved: true, typedFull: false, thisRefund: { id: 'adj_1', amount: 1900n, currency: 'USD' },
    storedTotal: total,
  }), false);
  assert.equal(decideRefundIsFull({
    approved: true, typedFull: false, thisRefund: eur('adj_1', '1900'),
  }), false, 'no transaction total → do not revoke');
  assert.equal(moneyFromTotals({ currency_code: 'eur', details: { totals: { grand_total: '1900' } } })?.currency, 'EUR');
  assert.equal(parseMinorUnits('19.00'), null);
  assert.equal(parseMinorUnits('1900'), 1900n);
});
