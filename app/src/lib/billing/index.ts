// Billing core: provider-neutral plan-change rules and a normalised event model.
// The provider (Paddle Billing as Merchant of Record; Creem stub) is chosen by BILLING_PROVIDER.
import { config } from '../../config.ts';
import { get, all, run, now, tx } from '../../db.ts';
import { PLANS, planOf, rank, isComped, type PlanId, LimitError } from '../plans.ts';
import type { Locale } from '../../i18n.ts';

export type Purchase = PlanId | 'oneoff';
export interface ChangePreview { kind: 'upgrade' | 'downgrade' | 'none'; effective: 'immediately' | 'period_end'; chargeCents: number; effectiveAt: string }
/** What the browser needs to take the customer to checkout. */
export interface CheckoutSpec { transactionId: string; url: string | null }
export interface SubscriptionPeriod { start: Date; end: Date }

export interface BillingProvider {
  readonly id: 'paddle' | 'creem';
  configured(): boolean;
  /** Public, non-secret settings for the client-side checkout (e.g. Paddle.js token). */
  clientConfig(): { script: string; token: string; environment: string } | null;
  /** Optional: read a finished checkout from the provider API (return-URL fallback when no webhook can reach this server, e.g. local sandbox). */
  syncTransaction?(team: any, transactionId: string): Promise<{ state: 'done' | 'pending' | 'foreign'; events: BillingEvent[] }>;
  checkout(team: any, email: string, what: Purchase, opts: { earlyBird: boolean; code?: boolean; locale: Locale }): Promise<CheckoutSpec>;
  /** Upgrades: immediately with a prorated charge. Downgrades: price changes for the next period, no charge or credit. */
  changePrice(team: any, to: PlanId, mode: 'prorated_now' | 'next_period'): Promise<SubscriptionPeriod>;
  currentPeriod(team: any): Promise<SubscriptionPeriod>;
  cancel(team: any, when: 'period_end' | 'immediately'): Promise<void>;
  portalUrl(team: any): Promise<string>;
  /** Verify a webhook signature and translate the payload into normalised events. Throws WebhookSignatureError. */
  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): { id: string; type: string; events: BillingEvent[] };
}
export class WebhookSignatureError extends Error {}
export class BillingNotConfigured extends Error {}

export type BillingEvent =
  | { kind: 'subscription'; teamId: string | null; subscriptionId: string; customerId: string | null; status: string; plan: PlanId | null; periodEnd: string | null; cancelAt: string | null }
  | { kind: 'subscription_canceled'; subscriptionId: string }
  | { kind: 'oneoff_paid'; teamId: string; customerId: string | null; transactionId?: string }
  | { kind: 'payment_failed'; subscriptionId: string }
  /** Approved refund or chargeback. full = the whole transaction was refunded. */
  | { kind: 'refund'; adjustmentId: string; transactionId: string; subscriptionId: string | null; customerId: string | null; full: boolean };

let _provider: BillingProvider | null | undefined;
export async function provider(): Promise<BillingProvider | null> {
  if (_provider !== undefined) return _provider;
  const id = config.billing.provider;
  _provider = id === 'paddle' ? new (await import('./paddle.ts')).PaddleProvider() : id === 'creem' ? new (await import('./creem.ts')).CreemProvider() : null;
  return _provider;
}
export const billingConfigured = async () => !!(await provider())?.configured();

/** Proration preview: upgrade charges the price difference for the remaining part of the period (rounded to cents). */
export function previewChange(from: PlanId, to: PlanId, periodStart: Date, periodEnd: Date, at = new Date()): ChangePreview {
  if (from === to) return { kind: 'none', effective: 'immediately', chargeCents: 0, effectiveAt: at.toISOString() };
  if (rank(to) < rank(from)) return { kind: 'downgrade', effective: 'period_end', chargeCents: 0, effectiveAt: periodEnd.toISOString() };
  const total = periodEnd.getTime() - periodStart.getTime();
  const remaining = Math.min(Math.max(periodEnd.getTime() - at.getTime(), 0), total);
  const diff = PLANS[to].priceCents - PLANS[from].priceCents;
  return { kind: 'upgrade', effective: 'immediately', chargeCents: total > 0 ? Math.round((diff * remaining) / total) : 0, effectiveAt: at.toISOString() };
}
/** A downgrade must fit the target plan's limits (sites, seats) before it is accepted. */
export function assertDowngradeFits(teamId: string, to: PlanId) {
  const p = PLANS[to];
  const sites = get<any>('SELECT COUNT(*) AS n FROM sites WHERE team_id = ?', teamId)!.n;
  const seats = get<any>('SELECT COUNT(*) AS n FROM memberships WHERE team_id = ?', teamId)!.n;
  if (sites > p.sites) throw new LimitError('downSites', to, p.sites, sites - p.sites);
  if (seats > p.seats) throw new LimitError('downSeats', to, p.seats, seats - p.seats);
}
export class CompedTeamError extends Error {}
export async function changePlan(team: any, to: PlanId): Promise<ChangePreview> {
  if (isComped(team)) throw new CompedTeamError(); // complimentary plan: never call the provider
  const prov = await provider(); if (!prov?.configured()) throw new BillingNotConfigured();
  const { start, end } = await prov.currentPeriod(team);
  const pv = previewChange(team.plan as PlanId, to, start, end);
  if (pv.kind === 'none') return pv;
  if (pv.kind === 'upgrade') {
    await prov.changePrice(team, to, 'prorated_now');
    run('UPDATE teams SET plan = ?, pending_plan = NULL WHERE id = ?', to, team.id);
  } else {
    assertDowngradeFits(team.id, to);
    await prov.changePrice(team, to, 'next_period');
    run('UPDATE teams SET pending_plan = ?, current_period_end = ? WHERE id = ?', to, end.toISOString(), team.id);
  }
  return pv;
}
/** Cancel at period end (dashboard) or immediately (account/team deletion). */
export async function cancelSubscription(team: any, when: 'period_end' | 'immediately') {
  if (!team.billing_subscription_id || isComped(team)) return false; // complimentary plan: never call the provider (IDs may be stale sandbox IDs)
  const prov = await provider(); if (!prov?.configured()) throw new BillingNotConfigured();
  await prov.cancel(team, when);
  if (when === 'immediately') run("UPDATE teams SET plan = 'none', pending_plan = NULL, subscription_status = 'canceled', billing_subscription_id = NULL, cancel_at = NULL WHERE id = ?", team.id);
  else run('UPDATE teams SET cancel_at = current_period_end WHERE id = ?', team.id);
  return true;
}
/** Scheduler: apply downgrades whose period has ended. */
export async function applyDueDowngrades(at = now()) {
  // Teams with an admin plan override are skipped: their effective plan never changes through billing.
  const due = all<any>("SELECT id, pending_plan FROM teams WHERE pending_plan IS NOT NULL AND current_period_end <= ? AND (plan_override IS NULL OR plan_override = '')", at);
  for (const t of due) run('UPDATE teams SET plan = pending_plan, pending_plan = NULL WHERE id = ?', t.id);
  return due.length;
}

/**
 * Apply normalised events from one webhook delivery. Idempotent via billing_events.
 * `cancelNow` collects subscriptions that must be cancelled at the provider afterwards (full refunds); see webhook route.
 */
export function applyBillingEvents(eventId: string, type: string, events: BillingEvent[], cancelNow: string[] = []) {
  return tx(() => {
    if (get('SELECT 1 FROM billing_events WHERE id = ?', eventId)) return 'duplicate';
    run('INSERT INTO billing_events (id, type, received_at) VALUES (?,?,?)', eventId, type, now());
    for (const ev of events) applyOne(ev, cancelNow);
    return 'ok';
  });
}
/** Once-only marker in billing_events; false if it already existed. */
const once = (key: string, type: string) => !!run('INSERT OR IGNORE INTO billing_events (id, type, received_at) VALUES (?,?,?)', key, type, now()).changes;
const refundedSub = (subscriptionId: string) => !!get('SELECT 1 FROM billing_events WHERE id = ?', `refunded_sub:${subscriptionId}`);
function applyOne(ev: BillingEvent, cancelNow: string[] = []) {
  switch (ev.kind) {
    case 'refund': {
      // The same adjustment arrives as adjustment.created and adjustment.updated (and as retries): apply it once.
      if (!once(`refund:${ev.adjustmentId}`, ev.full ? 'refund_full' : 'refund_partial')) return;
      if (!ev.full) return; // partial refund: plan and credits stay as they are
      if (ev.subscriptionId) {
        const team = get<any>('SELECT * FROM teams WHERE billing_subscription_id = ?', ev.subscriptionId);
        once(`refunded_sub:${ev.subscriptionId}`, 'refunded_sub'); // late "active" updates for this subscription must not reactivate it
        if (!team) return;
        run("UPDATE teams SET plan = 'none', pending_plan = NULL, subscription_status = 'canceled', billing_subscription_id = NULL, cancel_at = NULL WHERE id = ?", team.id);
        if (isComped(team)) return; // complimentary plan: effective plan untouched, provider never called
        run('UPDATE sites SET next_scan_at = NULL WHERE team_id = ?', team.id);
        cancelNow.push(ev.subscriptionId); // stop future renewals of the refunded subscription
        return;
      }
      // One-off report: take back the credit once, and only if this transaction had granted one.
      if (get('SELECT 1 FROM billing_events WHERE id = ?', `oneoff:${ev.transactionId}`) && ev.customerId)
        run('UPDATE teams SET oneoff_credits = MAX(oneoff_credits - 1, 0) WHERE id = (SELECT id FROM teams WHERE billing_customer_id = ? LIMIT 1)', ev.customerId);
      return;
    }
    case 'oneoff_paid':
      // The same purchase can arrive by webhook and by the return-URL sync: credit each transaction once.
      if (ev.transactionId && !run('INSERT OR IGNORE INTO billing_events (id, type, received_at) VALUES (?,?,?)', `oneoff:${ev.transactionId}`, 'oneoff_credit', now()).changes) return;
      run('UPDATE teams SET oneoff_credits = oneoff_credits + 1, billing_customer_id = COALESCE(billing_customer_id, ?) WHERE id = ?', ev.customerId, ev.teamId);
      return;
    case 'subscription': {
      const team = get<any>('SELECT * FROM teams WHERE billing_subscription_id = ? OR id = ?', ev.subscriptionId, ev.teamId ?? ''); if (!team) return;
      if (refundedSub(ev.subscriptionId)) return; // fully refunded: plan already ended; ignore later updates of that subscription
      const active = ['active', 'trialing', 'past_due'].includes(ev.status);
      const isNew = team.billing_subscription_id !== ev.subscriptionId;
      let plan = team.plan as PlanId;
      if (ev.plan && (isNew || rank(ev.plan) > rank(plan))) plan = ev.plan;          // new subscription, or upgrade: immediate
      else if (ev.plan && rank(ev.plan) < rank(plan) && team.pending_plan !== ev.plan) // downgrade made elsewhere (portal): defer to period end
        run('UPDATE teams SET pending_plan = ? WHERE id = ?', ev.plan, team.id);
      if (ev.plan === plan) run('UPDATE teams SET pending_plan = NULL WHERE id = ? AND pending_plan = ?', team.id, plan);
      run('UPDATE teams SET plan = ?, subscription_status = ?, current_period_end = COALESCE(?, current_period_end), billing_subscription_id = ?, billing_customer_id = COALESCE(?, billing_customer_id), cancel_at = ? WHERE id = ?',
        active ? plan : 'none', ev.status, ev.periodEnd, ev.subscriptionId, ev.customerId, ev.cancelAt, team.id);
      if (isComped(team)) return; // billed fields recorded; effective plan and monitoring schedule untouched
      if (isNew && active) scheduleSites(team.id, plan);
      if (!active) run('UPDATE sites SET next_scan_at = NULL WHERE team_id = ?', team.id);
      return;
    }
    case 'subscription_canceled':
      run("UPDATE sites SET next_scan_at = NULL WHERE team_id IN (SELECT id FROM teams WHERE billing_subscription_id = ? AND (plan_override IS NULL OR plan_override = ''))", ev.subscriptionId);
      run("UPDATE teams SET plan = 'none', pending_plan = NULL, subscription_status = 'canceled', billing_subscription_id = NULL, cancel_at = NULL WHERE billing_subscription_id = ?", ev.subscriptionId);
      return;
    case 'payment_failed':
      run("UPDATE teams SET subscription_status = 'past_due' WHERE billing_subscription_id = ?", ev.subscriptionId);
  }
}
function scheduleSites(teamId: string, planId: PlanId) {
  const plan = planOf(planId); if (!plan.frequency) return;
  for (const s of all<any>('SELECT id FROM sites WHERE team_id = ? AND verified_at IS NOT NULL AND next_scan_at IS NULL', teamId)) {
    run('INSERT INTO jobs (type, payload, run_at, created_at) VALUES (?,?,?,?)', 'site_scan', JSON.stringify({ siteId: s.id, kind: 'scheduled' }), now(), now());
    run('UPDATE sites SET next_scan_at = ? WHERE id = ?', new Date(Date.now() + (plan.frequency === 'daily' ? 1 : 7) * 86400_000).toISOString(), s.id);
  }
}

/** Apply what the provider reports for a checkout the user just returned from. Safe to repeat. */
export async function syncCheckout(team: any, transactionId: string) {
  const prov = await provider(); if (!prov?.configured() || !prov.syncTransaction || !/^[\w-]{3,64}$/.test(transactionId)) return 'skipped' as const;
  const r = await prov.syncTransaction(team, transactionId);
  if (r.state === 'done' && r.events.length) tx(() => { for (const ev of r.events) applyOne(ev); });
  return r.state;
}
