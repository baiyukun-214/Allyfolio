import type { FastifyInstance } from 'fastify';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import { PLANS, PAID, planOf, ONE_OFF, rank, LimitError, type PlanId } from '../lib/plans.ts';
import { stripe, stripeConfigured, createCheckout, portalUrl, changePlan, handleStripeEvent } from '../lib/billing.ts';
import { isEarlyBird } from '../lib/waitlist.ts';
import { config } from '../config.ts';
import { requireUser, render, back } from './guard.ts';
import { fmt } from './monitoring.ts';
const eur = (c: number) => `€${(c / 100).toFixed(0)}`;

export async function billingRoutes(app: FastifyInstance) {
  app.get('/app/billing', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const t = ctx.team, plan = planOf(t.plan), owner = ctx.role === 'owner';
    const eb = isEarlyBird(ctx.user.email) && !t.stripe_subscription_id;
    return render(reply, ctx, { title: 'Billing', current: '/app/billing', body: html`
      <h1>Billing</h1>
      ${!stripeConfigured() ? html`<p class="alert alert-error" role="note">Billing is not configured on this server yet (Stripe test keys missing). Plans can be set with <code>npm run set-plan</code> in development.</p>` : ''}
      <div class="card"><p class="muted small">Current plan</p><p class="stat">${plan.name}</p>
        ${t.subscription_status ? html`<p class="small muted">Status: ${t.subscription_status}${t.current_period_end ? html` · current period ends ${fmt(t.current_period_end)}` : ''}</p>` : ''}
        ${t.pending_plan ? html`<p class="notice">Your plan changes to <strong>${planOf(t.pending_plan).name}</strong> at the end of the current period. Until then you keep your ${plan.name} limits.</p>` : ''}
        ${t.oneoff_credits ? html`<p class="small">One-off report credits: <strong>${t.oneoff_credits}</strong></p>` : ''}
        ${owner && t.stripe_customer_id && stripeConfigured() ? html`<form method="post" action="/app/billing/portal">${csrfField(req)}<button class="btn btn-secondary" type="submit">Invoices and payment method</button></form>` : ''}
      </div>
      ${eb ? html`<p class="notice"><strong>Early-bird offer:</strong> as one of the first 100 waitlist members you get 30% off your first year. It is applied automatically at checkout.</p>` : ''}
      <h2>Plans</h2>
      <p class="small muted">Billed monthly in euros, excl. VAT. Cancel any time, no minimum term. Upgrades apply immediately with a prorated charge; downgrades apply from the next billing cycle.</p>
      <div class="grid g3">${PAID.map((id) => { const p = PLANS[id]; const cur = t.plan === id; return html`
        <div class="card"><h3>${p.name}</h3><p class="stat">${eur(p.priceCents)}<span class="small muted"> /month</span></p>
          <ul class="small"><li>${p.sites} site${p.sites === 1 ? '' : 's'}</li><li>Up to ${p.pagesPerSite.toLocaleString('en-GB')} pages per site</li><li>${p.frequency === 'daily' ? 'Daily' : 'Weekly'} scans</li><li>${p.retentionMonths}-month evidence history</li>${p.pdf ? html`<li>PDF report export</li>` : ''}${p.whiteLabel ? html`<li>White-label (agency-branded) reports</li>` : ''}<li>${p.seats} seat${p.seats === 1 ? '' : 's'}</li></ul>
          ${cur ? html`<p class="pill ok">Current plan</p>` : owner ? html`<form method="post" action="/app/billing/${t.stripe_subscription_id ? 'change' : 'checkout'}">${csrfField(req)}<input type="hidden" name="plan" value="${id}">
            <button class="btn ${rank(id) > rank(t.plan) ? 'btn-primary' : 'btn-secondary'}" type="submit" ${stripeConfigured() ? '' : 'disabled'}>${t.stripe_subscription_id ? (rank(id) > rank(t.plan) ? 'Upgrade now' : 'Downgrade at period end') : 'Choose'} <span class="sr-only">${p.name}</span></button></form>` : ''}
        </div>`; })}</div>
      <h2>One-off report</h2>
      <div class="card row between"><p style="margin:0">${eur(ONE_OFF.priceCents)} – 1 site, up to ${ONE_OFF.pages} pages, a single scan and a PDF report. No subscription.</p>
        ${owner ? html`<form method="post" action="/app/billing/checkout">${csrfField(req)}<input type="hidden" name="plan" value="oneoff"><button class="btn btn-secondary" type="submit" ${stripeConfigured() ? '' : 'disabled'}>Buy one-off report</button></form>` : ''}</div>` });
  });

  app.post('/app/billing/checkout', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    if (ctx.role !== 'owner') return back(reply, '/app/billing', 'err', 'Only the team owner can manage billing.');
    const what = String((req.body as any).plan) as PlanId | 'oneoff';
    if (what !== 'oneoff' && !PAID.includes(what as PlanId)) return back(reply, '/app/billing', 'err', 'Unknown plan.');
    if (what !== 'oneoff' && ctx.team.stripe_subscription_id) return back(reply, '/app/billing', 'err', 'You already have a subscription. Change plan instead.');
    try { const s = await createCheckout(ctx.team, ctx.user.email, what); return reply.redirect(s.url!, 303); }
    catch (e: any) { req.log.error(e); return back(reply, '/app/billing', 'err', 'Checkout is not available right now.'); }
  });

  app.post('/app/billing/change', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    if (ctx.role !== 'owner' || !ctx.team.stripe_subscription_id) return back(reply, '/app/billing', 'err', 'No subscription to change.');
    const to = String((req.body as any).plan) as PlanId; if (!PAID.includes(to)) return back(reply, '/app/billing', 'err', 'Unknown plan.');
    try {
      const pv = await changePlan(ctx.team, to);
      return back(reply, '/app/billing', 'ok', pv.kind === 'upgrade' ? `Upgraded to ${PLANS[to].name}. A prorated charge of ${eur(pv.chargeCents)} was invoiced.` : pv.kind === 'downgrade' ? `${PLANS[to].name} starts on ${fmt(pv.effectiveAt)}.` : 'No change.');
    } catch (e: any) { if (e instanceof LimitError) return back(reply, '/app/billing', 'err', e.message); req.log.error(e); return back(reply, '/app/billing', 'err', 'The plan change failed. Please try again.'); }
  });

  app.post('/app/billing/portal', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    if (ctx.role !== 'owner' || !ctx.team.stripe_customer_id) return back(reply, '/app/billing', 'err', 'No billing account yet.');
    try { return reply.redirect(await portalUrl(ctx.team), 303); } catch (e) { req.log.error(e); return back(reply, '/app/billing', 'err', 'The billing portal is not available right now.'); }
  });
}

/** Separate plugin so the webhook gets the raw body for signature checks. */
export async function stripeWebhook(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.post('/api/stripe/webhook', async (req, reply) => {
    if (!config.stripe.webhookSecret) return reply.code(503).send({ error: 'webhook not configured' });
    let event;
    try { event = stripe().webhooks.constructEvent(req.body as Buffer, String(req.headers['stripe-signature'] ?? ''), config.stripe.webhookSecret); }
    catch { return reply.code(400).send({ error: 'invalid signature' }); }
    return { received: true, result: handleStripeEvent(event) };
  });
}
