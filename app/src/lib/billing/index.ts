// Billing core: provider-neutral plan-change rules and a normalised event model.
// The provider (Paddle Billing as Merchant of Record; Creem stub) is chosen by BILLING_PROVIDER.
import { config } from '../../config.ts';
import { get, all, run, now, tx } from '../../db.ts';
import { PLANS, planOf, rank, type PlanId, LimitError } from '../plans.ts';
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
  checkout(team: any, email: string, what: Purchase, opts: { earlyBird: boolean; locale: Locale }): Promise<CheckoutSpec>;
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
  | { kind: 'oneoff_paid'; teamId: string; customerId: string | null }
  | { kind: 'payment_failed'; subscriptionId: string };

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
export async function changePlan(team: any, to: PlanId): Promise<ChangePreview> {
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
  if (!team.billing_subscription_id) return false;
  const prov = await provider(); if (!prov?.configured()) throw new BillingNotConfigured();
  await prov.cancel(team, when);
  if (when === 'immediately') run("UPDATE teams SET plan = 'none', pending_plan = NULL, subscription_status = 'canceled', billing_subscription_id = NULL, cancel_at = NULL WHERE id = ?", team.id);
  else run('UPDATE teams SET cancel_at = current_period_end WHERE id = ?', team.id);
  return true;
}
/** Scheduler: apply downgrades whose period has ended. */
export async function applyDueDowngrades(at = now()) {
  const due = all<any>('SELECT id, pending_plan FROM teams WHERE pending_plan IS NOT NULL AND current_period_end <= ?', at);
  for (const t of due) run('UPDATE teams SET plan = pending_plan, pending_plan = NULL WHERE id = ?', t.id);
  return due.length;
}

/** Apply normalised events from one webhook delivery. Idempotent via billing_events. */
export function applyBillingEvents(eventId: string, type: string, events: BillingEvent[]) {
  return tx(() => {
    if (get('SELECT 1 FROM billing_events WHERE id = ?', eventId)) return 'duplicate';
    run('INSERT INTO billing_events (id, type, received_at) VALUES (?,?,?)', eventId, type, now());
    for (const ev of events) applyOne(ev);
    return 'ok';
  });
}
function applyOne(ev: BillingEvent) {
  switch (ev.kind) {
    case 'oneoff_paid':
      run('UPDATE teams SET oneoff_credits = oneoff_credits + 1, billing_customer_id = COALESCE(billing_customer_id, ?) WHERE id = ?', ev.customerId, ev.teamId);
      return;
    case 'subscription': {
      const team = get<any>('SELECT * FROM teams WHERE billing_subscription_id = ? OR id = ?', ev.subscriptionId, ev.teamId ?? ''); if (!team) return;
      const active = ['active', 'trialing', 'past_due'].includes(ev.status);
      const isNew = team.billing_subscription_id !== ev.subscriptionId;
      let plan = team.plan as PlanId;
      if (ev.plan && (isNew || rank(ev.plan) > rank(plan))) plan = ev.plan;          // new subscription, or upgrade: immediate
      else if (ev.plan && rank(ev.plan) < rank(plan) && team.pending_plan !== ev.plan) // downgrade made elsewhere (portal): defer to period end
        run('UPDATE teams SET pending_plan = ? WHERE id = ?', ev.plan, team.id);
      if (ev.plan === plan) run('UPDATE teams SET pending_plan = NULL WHERE id = ? AND pending_plan = ?', team.id, plan);
      run('UPDATE teams SET plan = ?, subscription_status = ?, current_period_end = COALESCE(?, current_period_end), billing_subscription_id = ?, billing_customer_id = COALESCE(?, billing_customer_id), cancel_at = ? WHERE id = ?',
        active ? plan : 'none', ev.status, ev.periodEnd, ev.subscriptionId, ev.customerId, ev.cancelAt, team.id);
      if (isNew && active) scheduleSites(team.id, plan);
      if (!active) run('UPDATE sites SET next_scan_at = NULL WHERE team_id = ?', team.id);
      return;
    }
    case 'subscription_canceled':
      run("UPDATE sites SET next_scan_at = NULL WHERE team_id IN (SELECT id FROM teams WHERE billing_subscription_id = ?)", ev.subscriptionId);
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
