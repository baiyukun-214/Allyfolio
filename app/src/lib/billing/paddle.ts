// Paddle Billing (Merchant of Record). Sandbox by default: PADDLE_ENV=sandbox → https://sandbox-api.paddle.com
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.ts';
import type { PlanId } from '../plans.ts';
import type { BillingEvent, BillingProvider, CheckoutSpec, Purchase, SubscriptionPeriod } from './index.ts';
import { WebhookSignatureError } from './index.ts';
import { all, get, now, run } from '../../db.ts';
import { approvedRefundAmount, decideRefundIsFull, isApprovedRefundOrChargeback, isTypedFull, moneyFromTotals, type Money, type RefundAmt } from './refundCoverage.ts';
import type { Locale } from '../../i18n.ts';

const P = () => config.billing.paddle;
const SUB_PLANS: PlanId[] = ['starter', 'business', 'agency'];
export const paddlePrice = (what: Purchase) => (P().prices as Record<string, string>)[what] ?? '';
export const planForPaddlePrice = (priceId: string | undefined): PlanId | null => SUB_PLANS.find((p) => priceId && paddlePrice(p) === priceId) ?? null;
const apiBase = () => P().apiBase || (P().env === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');
/** Paddle.js checkout locale codes. */
export const paddleLocale = (l: Locale) => (l === 'zh-CN' ? 'zh-Hans' : 'en');

export class PaddleApiError extends Error { constructor(public status: number, public code: string, msg: string) { super(msg); } }
async function api<T = any>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const r = await fetch(apiBase() + path, {
    method, signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${P().apiKey}`, 'content-type': 'application/json', 'paddle-version': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PaddleApiError(r.status, j?.error?.code ?? 'unknown', `Paddle ${method} ${path} → ${r.status} ${j?.error?.detail ?? ''}`);
  return j.data as T;
}

const refundAmtKey = (txnId: string, adjId: string) => `refund_amt:${txnId}:${adjId}`;
const refundTxnKey = (txnId: string) => `refund_txn_total:${txnId}`;
function parseStoredMoney(type: string | undefined): Money | null {
  if (!type) return null;
  const i = type.lastIndexOf(':');
  if (i <= 0) return null;
  const amount = type.slice(i + 1);
  if (!/^\d+$/.test(amount)) return null;
  const currency = type.slice(0, i);
  return currency ? { amount: BigInt(amount), currency } : null;
}
function rememberRefundAmount(txnId: string, adj: RefundAmt) {
  run('INSERT OR IGNORE INTO billing_events (id, type, received_at) VALUES (?,?,?)', refundAmtKey(txnId, adj.id), `${adj.currency}:${adj.amount}`, now());
}
function rememberTxnTotal(txnId: string, m: Money) {
  run('INSERT OR IGNORE INTO billing_events (id, type, received_at) VALUES (?,?,?)', refundTxnKey(txnId), `${m.currency}:${m.amount}`, now());
}
function storedRefundAmounts(txnId: string): RefundAmt[] {
  const rows = all<{ id: string; type: string }>('SELECT id, type FROM billing_events WHERE id LIKE ?', `refund_amt:${txnId}:%`);
  const out: RefundAmt[] = [];
  for (const r of rows) {
    const m = parseStoredMoney(r.type);
    const adjId = r.id.slice(`refund_amt:${txnId}:`.length);
    if (m && adjId) out.push({ id: adjId, ...m });
  }
  return out;
}
function storedTxnTotal(txnId: string): Money | null {
  return parseStoredMoney(get<{ type: string }>('SELECT type FROM billing_events WHERE id = ?', refundTxnKey(txnId))?.type);
}

/** List adjustments for a transaction (paginated). Throws on HTTP errors so the caller can fail safe. */
async function listAdjustments(txnId: string): Promise<any[]> {
  const out: any[] = [];
  let after: string | undefined;
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ transaction_id: txnId, per_page: '200' });
    if (after) q.set('after', after);
    const r = await fetch(`${apiBase()}/adjustments?${q}`, {
      method: 'GET', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${P().apiKey}`, 'content-type': 'application/json', 'paddle-version': '1' },
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new PaddleApiError(r.status, j?.error?.code ?? 'unknown', `Paddle GET /adjustments → ${r.status}`);
    const data = Array.isArray(j.data) ? j.data : [];
    out.push(...data);
    if (!j.meta?.pagination?.has_more) break;
    after = j.meta?.pagination?.after ?? data.at(-1)?.id;
    if (!after) break;
  }
  return out;
}

/** type=full stays full; otherwise approved refunds covering the tax-inclusive transaction total also count as full. Fail-safe on missing data or API errors. */
async function resolveRefundIsFull(d: any): Promise<boolean> {
  const approved = isApprovedRefundOrChargeback(d);
  const typedFull = isTypedFull(d);
  const thisRefund = approvedRefundAmount(d);
  if (thisRefund) rememberRefundAmount(d.transaction_id, thisRefund);
  if (!approved) return false;
  if (typedFull) return true;

  let storedTotal = storedTxnTotal(d.transaction_id);
  const payloadTxn = moneyFromTotals(d.transaction) ?? moneyFromTotals({ currency_code: d.currency_code, totals: d.transaction_totals ?? d.transaction_total });
  if (!storedTotal && payloadTxn) { rememberTxnTotal(d.transaction_id, payloadTxn); storedTotal = payloadTxn; }

  let fetchedTotal: Money | null = null;
  let fetchedRefunds: RefundAmt[] | null = null;
  try {
    const txn = await api('GET', `/transactions/${encodeURIComponent(d.transaction_id)}`);
    fetchedTotal = moneyFromTotals(txn);
    if (fetchedTotal) rememberTxnTotal(d.transaction_id, fetchedTotal);
  } catch { /* keep stored / payload total */ }
  try {
    const list = await listAdjustments(d.transaction_id);
    fetchedRefunds = [];
    for (const adj of list) {
      const m = approvedRefundAmount(adj);
      if (!m) continue;
      rememberRefundAmount(d.transaction_id, m);
      fetchedRefunds.push(m);
    }
  } catch { fetchedRefunds = null; }

  return decideRefundIsFull({
    approved, typedFull, thisRefund,
    storedRefunds: storedRefundAmounts(d.transaction_id),
    storedTotal: storedTxnTotal(d.transaction_id),
    fetchedTotal, fetchedRefunds,
  });
}

/** Verify `Paddle-Signature: ts=…;h1=…` (HMAC-SHA256 over `${ts}:${rawBody}`), allowing several h1 values during secret rotation. */
export function verifyPaddleSignature(raw: Buffer, header: string | undefined, secret: string, toleranceS = 300, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = header.split(';').map((p) => p.split('=') as [string, string]);
  const ts = parts.find(([k]) => k === 'ts')?.[1]; const sigs = parts.filter(([k]) => k === 'h1').map(([, v]) => v);
  if (!ts || !/^\d+$/.test(ts) || !sigs.length || Math.abs(nowS - Number(ts)) > toleranceS) return false;
  const expected = createHmac('sha256', secret).update(`${ts}:`).update(raw).digest();
  return sigs.some((s) => { const b = Buffer.from(s, 'hex'); return b.length === expected.length && timingSafeEqual(b, expected); });
}
export const signPaddle = (raw: string, secret: string, ts = Math.floor(Date.now() / 1000)) => `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex')}`;

const periodOf = (sub: any): SubscriptionPeriod => ({ start: new Date(sub.current_billing_period?.starts_at), end: new Date(sub.current_billing_period?.ends_at) });

export class PaddleProvider implements BillingProvider {
  readonly id = 'paddle' as const;
  configured() { const p = P(); return !!(p.apiKey && p.prices.starter && p.prices.business && p.prices.agency && p.prices.oneoff); }
  clientConfig() { const p = P(); return p.clientToken ? { script: 'https://cdn.paddle.com/paddle/v2/paddle.js', token: p.clientToken, environment: p.env } : null; }

  /** Server-side transaction (price, discount and team binding are decided here, not in the browser); Paddle.js opens it as an overlay. */
  async checkout(team: any, email: string, what: Purchase, opts: { earlyBird: boolean; code?: boolean; locale: Locale }): Promise<CheckoutSpec> {
    const price = paddlePrice(what); if (!price) throw new Error(`No Paddle price configured for ${what}`);
    // Early bird (by waitlist email) first; otherwise the fallback code if the customer entered it. Never on the one-off.
    const discount = what === 'oneoff' ? undefined : opts.earlyBird && P().earlyBirdDiscount ? P().earlyBirdDiscount : opts.code ? P().discountCodeId || undefined : undefined;
    const tx = await api('POST', '/transactions', {
      items: [{ price_id: price, quantity: 1 }],
      ...(team.billing_customer_id ? { customer_id: team.billing_customer_id } : {}),
      ...(discount ? { discount_id: discount } : {}),
      collection_mode: 'automatic',
      custom_data: { team_id: team.id, kind: what, email },
    });
    return { transactionId: tx.id, url: tx.checkout?.url ?? null };
  }
  async currentPeriod(team: any) { return periodOf(await api('GET', `/subscriptions/${team.billing_subscription_id}`)); }
  async changePrice(team: any, to: PlanId, mode: 'prorated_now' | 'next_period') {
    const sub = await api('PATCH', `/subscriptions/${team.billing_subscription_id}`, {
      items: [{ price_id: paddlePrice(to), quantity: 1 }],
      // Upgrade: charge the prorated difference now. Downgrade: new (lower) price is billed from the next renewal; no charge or credit now.
      proration_billing_mode: mode === 'prorated_now' ? 'prorated_immediately' : 'do_not_bill',
      ...(mode === 'prorated_now' ? { on_payment_failure: 'prevent_change' } : {}),
      custom_data: { team_id: team.id, plan: to },
    });
    return periodOf(sub);
  }
  async cancel(team: any, when: 'period_end' | 'immediately') {
    await api('POST', `/subscriptions/${team.billing_subscription_id}/cancel`, { effective_from: when === 'immediately' ? 'immediately' : 'next_billing_period' });
  }
  async portalUrl(team: any) {
    const s = await api('POST', `/customers/${team.billing_customer_id}/portal-sessions`, team.billing_subscription_id ? { subscription_ids: [team.billing_subscription_id] } : {});
    return s.urls.general.overview as string;
  }

  async syncTransaction(team: any, transactionId: string) {
    const t = await api('GET', `/transactions/${encodeURIComponent(transactionId)}`);
    if (t.custom_data?.team_id !== team.id) return { state: 'foreign' as const, events: [] };
    if (!['paid', 'completed'].includes(t.status)) return { state: 'pending' as const, events: [] };
    if (!t.subscription_id) return { state: 'done' as const, events: t.custom_data?.kind === 'oneoff' || t.items?.some((i: any) => i.price?.id === paddlePrice('oneoff'))
      ? [{ kind: 'oneoff_paid' as const, teamId: team.id, customerId: t.customer_id ?? null, transactionId: t.id }] : [] };
    const d = await api('GET', `/subscriptions/${t.subscription_id}`);
    return { state: 'done' as const, events: [{ kind: 'subscription' as const, teamId: team.id, subscriptionId: d.id, customerId: d.customer_id ?? null, status: d.status,
      plan: planForPaddlePrice(d.items?.[0]?.price?.id), periodEnd: d.current_billing_period?.ends_at ?? null, cancelAt: d.scheduled_change?.action === 'cancel' ? d.scheduled_change.effective_at : null }] };
  }

  async parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>) {
    const sig = headers['paddle-signature']; if (!verifyPaddleSignature(raw, Array.isArray(sig) ? sig[0] : sig, P().webhookSecret)) throw new WebhookSignatureError('invalid signature');
    const n = JSON.parse(raw.toString('utf8'));
    const d = n.data ?? {}; const events: BillingEvent[] = [];
    switch (n.event_type) {
      case 'subscription.created': case 'subscription.updated': case 'subscription.activated': case 'subscription.past_due': case 'subscription.resumed': case 'subscription.paused':
        events.push({ kind: 'subscription', teamId: d.custom_data?.team_id ?? null, subscriptionId: d.id, customerId: d.customer_id ?? null, status: d.status,
          plan: planForPaddlePrice(d.items?.[0]?.price?.id), periodEnd: d.current_billing_period?.ends_at ?? null,
          cancelAt: d.scheduled_change?.action === 'cancel' ? d.scheduled_change.effective_at : null });
        break;
      case 'subscription.canceled': events.push({ kind: 'subscription_canceled', subscriptionId: d.id }); break;
      case 'transaction.completed': {
        const tot = d.id ? moneyFromTotals(d) : null;
        if (tot && d.id) rememberTxnTotal(d.id, tot);
        // One-off report: a completed transaction without a subscription for the one-off price.
        if (!d.subscription_id && d.custom_data?.team_id && (d.custom_data?.kind === 'oneoff' || d.items?.some((i: any) => i.price?.id === paddlePrice('oneoff'))))
          events.push({ kind: 'oneoff_paid', teamId: d.custom_data.team_id, customerId: d.customer_id ?? null, transactionId: d.id });
        break;
      }
      case 'transaction.payment_failed':
        if (d.subscription_id) events.push({ kind: 'payment_failed', subscriptionId: d.subscription_id });
        break;
      case 'adjustment.created': case 'adjustment.updated': {
        // Refunds (and chargebacks) need approval in Paddle: act only once the adjustment is approved.
        if (!isApprovedRefundOrChargeback(d)) break;
        const full = await resolveRefundIsFull(d);
        events.push({ kind: 'refund', adjustmentId: d.id, transactionId: d.transaction_id, subscriptionId: d.subscription_id ?? null, customerId: d.customer_id ?? null, full });
        break;
      }
    }
    return { id: String(n.event_id ?? n.notification_id), type: String(n.event_type), events };
  }
}
