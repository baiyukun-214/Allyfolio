// Decide whether approved refunds (any type) already cover a transaction's tax-inclusive total.
// Pure helpers: I/O (store / Paddle GET) lives with the Paddle webhook parser.

export type Money = { amount: bigint; currency: string };
export type RefundAmt = Money & { id: string };

export function parseMinorUnits(v: unknown): bigint | null {
  if (v == null) return null;
  const s = typeof v === 'bigint' ? v.toString() : String(v);
  if (!/^\d+$/.test(s)) return null;
  return BigInt(s);
}

export function normalizeCurrency(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/** Tax-inclusive total from a Paddle transaction or adjustment (`grand_total`, else `total`). */
export function moneyFromTotals(obj: any, currency = obj?.currency_code): Money | null {
  const cur = normalizeCurrency(currency);
  if (!cur || !obj) return null;
  const totals = obj.details?.totals ?? obj.totals ?? {};
  const amount = parseMinorUnits(totals.grand_total ?? totals.total);
  if (amount == null) return null;
  return { amount, currency: cur };
}

export function refundAmountFromAdjustment(d: any): Money | null {
  const fromTotals = moneyFromTotals(d, d?.currency_code);
  if (fromTotals) return fromTotals;
  const cur = normalizeCurrency(d?.currency_code);
  if (!cur || !Array.isArray(d?.items) || d.items.length === 0) return null;
  let sum = 0n;
  for (const item of d.items) {
    const a = parseMinorUnits(item?.amount);
    if (a == null) return null;
    sum += a;
  }
  return { amount: sum, currency: cur };
}

export function isTypedFull(d: any): boolean {
  return d?.type === 'full' || (d?.type == null && Array.isArray(d?.items) && d.items.length > 0 && d.items.every((i: any) => i.type === 'full'));
}

export function isApprovedRefundOrChargeback(d: any): boolean {
  return ['refund', 'chargeback'].includes(d?.action) && d?.status === 'approved' && !!d?.id && !!d?.transaction_id;
}

export function approvedRefundAmount(d: any): RefundAmt | null {
  if (!['refund', 'chargeback'].includes(d?.action) || d?.status !== 'approved' || !d?.id) return null;
  const m = refundAmountFromAdjustment(d);
  return m ? { id: String(d.id), ...m } : null;
}

export function mergeRefunds(...lists: Array<RefundAmt[] | null | undefined>): RefundAmt[] {
  const map = new Map<string, RefundAmt>();
  for (const list of lists) {
    if (!list) continue;
    for (const r of list) map.set(r.id, r);
  }
  return [...map.values()];
}

/** Same currency only. Any approved refund in a different currency is inconclusive (not covering). */
export function cumulativeCovers(refunds: RefundAmt[], total: Money): boolean {
  if (!refunds.length) return false;
  if (refunds.some((r) => r.currency !== total.currency)) return false;
  const sum = refunds.reduce((a, r) => a + r.amount, 0n);
  return sum >= total.amount;
}

/**
 * Whether this approved adjustment should revoke entitlements as a full refund.
 * Only `status=approved` refunds/chargebacks count. Fail-safe: missing totals or mixed currencies → false
 * (unless Paddle marked the adjustment itself as type=full).
 */
export function decideRefundIsFull(input: {
  approved: boolean;
  typedFull: boolean;
  thisRefund: RefundAmt | null;
  storedRefunds?: RefundAmt[];
  storedTotal?: Money | null;
  fetchedTotal?: Money | null;
  fetchedRefunds?: RefundAmt[] | null;
}): boolean {
  if (!input.approved) return false;
  if (input.typedFull) return true;
  const total = input.fetchedTotal ?? input.storedTotal ?? null;
  if (!total) return false;
  const refunds = mergeRefunds(input.storedRefunds, input.fetchedRefunds, input.thisRefund ? [input.thisRefund] : []);
  return cumulativeCovers(refunds, total);
}
