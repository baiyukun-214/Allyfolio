import Stripe from 'stripe';
import { config, stripeConfigured } from '../config.ts';
import { get, all, run, now, tx } from '../db.ts';
import { PLANS, planOf, rank, type PlanId, LimitError } from './plans.ts';
import { isEarlyBird } from './waitlist.ts';

let _stripe: Stripe | undefined;
export function stripe(): Stripe {
  if (!stripeConfigured()) throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY (test mode) and the price IDs.');
  return (_stripe ??= new Stripe(config.stripe.secretKey));
}
export const priceFor = (p: PlanId) => (config.stripe.prices as any)[p] as string;
export const planForPrice = (price: string): PlanId | null => (['starter', 'business', 'agency'] as PlanId[]).find((p) => priceFor(p) === price) ?? null;

export interface ChangePreview { kind: 'upgrade' | 'downgrade' | 'none'; effective: 'immediately' | 'period_end'; chargeCents: number; effectiveAt: string }
/**
 * Plan change rules: upgrades apply immediately and charge the price difference for the remaining
 * part of the current period (prorated, rounded to cents); downgrades apply at the end of the period with no charge or credit.
 * Mirrors Stripe's proration_behavior 'always_invoice' (time-based proration) so the dashboard can preview the charge.
 */
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
  if (sites > p.sites) throw new LimitError(`${p.name} includes ${p.sites} site${p.sites === 1 ? '' : 's'}. Remove ${sites - p.sites} site(s) first.`);
  if (seats > p.seats) throw new LimitError(`${p.name} includes ${p.seats} seat${p.seats === 1 ? '' : 's'}. Remove ${seats - p.seats} member(s) first.`);
}

async function ensureCustomer(team: any, email: string) {
  if (team.stripe_customer_id) return team.stripe_customer_id as string;
  const c = await stripe().customers.create({ email, metadata: { team_id: team.id } });
  run('UPDATE teams SET stripe_customer_id = ? WHERE id = ?', c.id, team.id);
  return c.id;
}
export async function createCheckout(team: any, email: string, what: PlanId | 'oneoff') {
  const customer = await ensureCustomer(team, email);
  const base = { customer, client_reference_id: team.id, success_url: `${config.appUrl}/app/billing?ok=${encodeURIComponent('Payment received. Thank you!')}`, cancel_url: `${config.appUrl}/app/billing`, metadata: { team_id: team.id, kind: what } };
  if (what === 'oneoff') {
    return stripe().checkout.sessions.create({ ...base, mode: 'payment', line_items: [{ price: priceFor('oneoff' as any), quantity: 1 }], invoice_creation: { enabled: true } });
  }
  // Early-bird: 30% off the first year for the first 100 confirmed waitlist members (coupon: repeating, 12 months).
  const earlyBird = isEarlyBird(email) && config.stripe.earlyBirdCoupon && !get('SELECT 1 FROM teams WHERE id = ? AND stripe_subscription_id IS NOT NULL', team.id);
  return stripe().checkout.sessions.create({ ...base, mode: 'subscription', line_items: [{ price: priceFor(what), quantity: 1 }],
    subscription_data: { metadata: { team_id: team.id, plan: what } },
    ...(earlyBird ? { discounts: [{ coupon: config.stripe.earlyBirdCoupon }] } : { allow_promotion_codes: true }) });
}
export async function portalUrl(team: any) {
  const s = await stripe().billingPortal.sessions.create({ customer: team.stripe_customer_id, return_url: `${config.appUrl}/app/billing` });
  return s.url;
}
export async function changePlan(team: any, to: PlanId): Promise<ChangePreview> {
  const from = team.plan as PlanId;
  const sub = await stripe().subscriptions.retrieve(team.stripe_subscription_id);
  const item = sub.items.data[0];
  const { start, end } = periodOf(sub);
  const pv = previewChange(from, to, start, end);
  if (pv.kind === 'none') return pv;
  if (pv.kind === 'upgrade') {
    await stripe().subscriptions.update(sub.id, { items: [{ id: item.id, price: priceFor(to) }], proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete', metadata: { team_id: team.id, plan: to } });
    run('UPDATE teams SET plan = ?, pending_plan = NULL WHERE id = ?', to, team.id);
  } else {
    assertDowngradeFits(team.id, to);
    // New price from the next billing cycle, no proration; keep current limits until the period ends.
    await stripe().subscriptions.update(sub.id, { items: [{ id: item.id, price: priceFor(to) }], proration_behavior: 'none', metadata: { team_id: team.id, plan: to } });
    run('UPDATE teams SET pending_plan = ?, current_period_end = ? WHERE id = ?', to, end.toISOString(), team.id);
  }
  return pv;
}
function periodOf(sub: any) {
  const item = sub.items?.data?.[0] ?? {};
  const s = item.current_period_start ?? sub.current_period_start, e = item.current_period_end ?? sub.current_period_end;
  return { start: new Date(s * 1000), end: new Date(e * 1000) };
}
/** Scheduler: apply downgrades whose period has ended. */
export async function applyDueDowngrades(at = now()) {
  const due = all<any>('SELECT id, pending_plan FROM teams WHERE pending_plan IS NOT NULL AND current_period_end <= ?', at);
  for (const t of due) run('UPDATE teams SET plan = pending_plan, pending_plan = NULL WHERE id = ?', t.id);
  return due.length;
}

/** Webhook handler. Uses only event payloads (no extra API calls) and is idempotent via stripe_events. */
export function handleStripeEvent(event: Stripe.Event) {
  return tx(() => {
    if (get('SELECT 1 FROM stripe_events WHERE id = ?', event.id)) return 'duplicate';
    run('INSERT INTO stripe_events (id, type, received_at) VALUES (?,?,?)', event.id, event.type, now());
    const o: any = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const teamId = o.client_reference_id ?? o.metadata?.team_id; if (!teamId) break;
        if (o.mode === 'payment' && o.metadata?.kind === 'oneoff' && o.payment_status === 'paid') run('UPDATE teams SET oneoff_credits = oneoff_credits + 1, stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?', o.customer, teamId);
        if (o.mode === 'subscription' && PLANS[o.metadata?.kind as PlanId]) {
          run("UPDATE teams SET plan = ?, stripe_subscription_id = ?, stripe_customer_id = ?, subscription_status = 'active', pending_plan = NULL WHERE id = ?", o.metadata.kind, o.subscription, o.customer, teamId);
          const plan = planOf(o.metadata.kind);
          for (const s of all<any>('SELECT id FROM sites WHERE team_id = ? AND verified_at IS NOT NULL AND next_scan_at IS NULL', teamId))
            run('INSERT INTO jobs (type, payload, run_at, created_at) VALUES (?,?,?,?)', 'site_scan', JSON.stringify({ siteId: s.id, kind: 'scheduled' }), now(), now()),
            run('UPDATE sites SET next_scan_at = ? WHERE id = ?', new Date(Date.now() + (plan.frequency === 'daily' ? 1 : 7) * 86400_000).toISOString(), s.id);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const team = get<any>('SELECT * FROM teams WHERE stripe_subscription_id = ? OR id = ?', o.id, o.metadata?.team_id ?? ''); if (!team) break;
        const { end } = periodOf(o);
        const pricePlan = planForPrice(o.items?.data?.[0]?.price?.id);
        const active = ['active', 'trialing', 'past_due'].includes(o.status);
        let plan = team.plan as PlanId;
        if (pricePlan && rank(pricePlan) > rank(plan)) plan = pricePlan;              // upgrade (e.g. via portal) applies immediately
        else if (pricePlan && rank(pricePlan) < rank(plan) && team.pending_plan !== pricePlan) // downgrade via portal: defer to period end
          run('UPDATE teams SET pending_plan = ? WHERE id = ?', pricePlan, team.id);
        run('UPDATE teams SET plan = ?, subscription_status = ?, current_period_end = ?, stripe_subscription_id = ? WHERE id = ?', active ? plan : 'none', o.status, end.toISOString(), o.id, team.id);
        break;
      }
      case 'customer.subscription.deleted':
        run("UPDATE teams SET plan = 'none', pending_plan = NULL, subscription_status = 'canceled', stripe_subscription_id = NULL WHERE stripe_subscription_id = ?", o.id);
        run("UPDATE sites SET next_scan_at = NULL WHERE team_id IN (SELECT id FROM teams WHERE plan = 'none')");
        break;
      case 'invoice.payment_failed':
        run("UPDATE teams SET subscription_status = 'past_due' WHERE stripe_customer_id = ?", o.customer);
        break;
    }
    return 'ok';
  });
}
export { stripeConfigured };
