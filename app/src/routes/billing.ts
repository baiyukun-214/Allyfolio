import type { FastifyInstance } from 'fastify';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import { PLANS, PAID, planOf, ONE_OFF, rank, LimitError, type PlanId } from '../lib/plans.ts';
import { stripe, stripeConfigured, createCheckout, portalUrl, changePlan, handleStripeEvent } from '../lib/billing.ts';
import { isEarlyBird } from '../lib/waitlist.ts';
import { config } from '../config.ts';
import { requireUser, render, back, loc } from './guard.ts';
import { fmt } from './monitoring.ts';
import { t as tr } from '../i18n.ts';
const eur = (c: number) => `€${(c / 100).toFixed(0)}`;

export async function billingRoutes(app: FastifyInstance) {
  app.get('/app/billing', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    const t = ctx.team, plan = planOf(t.plan), owner = ctx.role === 'owner';
    const eb = isEarlyBird(ctx.user.email) && !t.stripe_subscription_id;
    const l = loc(req, ctx), Tx = tr(l), B = Tx.bill; const pn = (id: string) => Tx.plans[id] ?? planOf(id).name;
    const pend = t.pending_plan ? B.pending(pn(t.pending_plan), pn(plan.id)) : null;
    return render(reply, ctx, { title: B.title, current: '/app/billing', body: html`
      <h1>${B.title}</h1>
      ${!stripeConfigured() ? html`<p class="alert alert-error" role="note">${B.notConfigured}</p>` : ''}
      <div class="card"><p class="muted small">${B.current}</p><p class="stat">${pn(plan.id)}</p>
        ${t.subscription_status ? html`<p class="small muted">${B.status}: ${t.subscription_status}${t.current_period_end ? html` · ${B.periodEnds} ${fmt(t.current_period_end, l)}` : ''}</p>` : ''}
        ${pend ? html`<p class="notice">${pend[0]}<strong>${pend[1]}</strong>${pend[2]}</p>` : ''}
        ${t.oneoff_credits ? html`<p class="small">${B.credits}: <strong>${t.oneoff_credits}</strong></p>` : ''}
        ${owner && t.stripe_customer_id && stripeConfigured() ? html`<form method="post" action="/app/billing/portal">${csrfField(req)}<button class="btn btn-secondary" type="submit">${B.portal}</button></form>` : ''}
      </div>
      ${eb ? html`<p class="notice"><strong>${B.earlyH}</strong> ${B.early}</p>` : ''}
      <h2>${B.plans}</h2>
      <p class="small muted">${B.terms}</p>
      <div class="grid g3">${PAID.map((id) => { const p = PLANS[id]; const cur = t.plan === id; return html`
        <div class="card"><h3>${pn(id)}</h3><p class="stat">${eur(p.priceCents)}<span class="small muted"> ${B.perMonth}</span></p>
          <ul class="small"><li>${B.sitesN(p.sites)}</li><li>${B.pagesN(p.pagesPerSite)}</li><li>${p.frequency === 'daily' ? B.daily : B.weekly}</li><li>${B.history(p.retentionMonths)}</li>${p.pdf ? html`<li>${B.pdf}</li>` : ''}${p.whiteLabel ? html`<li>${B.wl}</li>` : ''}<li>${B.seatsN(p.seats)}</li></ul>
          ${cur ? html`<p class="pill ok">${B.currentPill}</p>` : owner ? html`<form method="post" action="/app/billing/${t.stripe_subscription_id ? 'change' : 'checkout'}">${csrfField(req)}<input type="hidden" name="plan" value="${id}">
            <button class="btn ${rank(id) > rank(t.plan) ? 'btn-primary' : 'btn-secondary'}" type="submit" ${stripeConfigured() ? '' : 'disabled'}>${t.stripe_subscription_id ? (rank(id) > rank(t.plan) ? B.upgrade : B.downgrade) : B.choose} <span class="sr-only">${pn(id)}</span></button></form>` : ''}
        </div>`; })}</div>
      <h2>${B.oneoffH}</h2>
      <div class="card row between"><p style="margin:0">${B.oneoff(eur(ONE_OFF.priceCents))}</p>
        ${owner ? html`<form method="post" action="/app/billing/checkout">${csrfField(req)}<input type="hidden" name="plan" value="oneoff"><button class="btn btn-secondary" type="submit" ${stripeConfigured() ? '' : 'disabled'}>${B.buyOneoff}</button></form>` : ''}</div>` });
  });

  app.post('/app/billing/checkout', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const B = tr(loc(req, ctx)).bill;
    if (ctx.role !== 'owner') return back(reply, '/app/billing', 'err', B.ownerOnly);
    const what = String((req.body as any).plan) as PlanId | 'oneoff';
    if (what !== 'oneoff' && !PAID.includes(what as PlanId)) return back(reply, '/app/billing', 'err', B.unknown);
    if (what !== 'oneoff' && ctx.team.stripe_subscription_id) return back(reply, '/app/billing', 'err', B.hasSub);
    try { const s = await createCheckout(ctx.team, ctx.user.email, what); return reply.redirect(s.url!, 303); }
    catch (e: any) { req.log.error(e); return back(reply, '/app/billing', 'err', B.checkoutFail); }
  });

  app.post('/app/billing/change', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const l = loc(req, ctx), Tx = tr(l), B = Tx.bill;
    if (ctx.role !== 'owner' || !ctx.team.stripe_subscription_id) return back(reply, '/app/billing', 'err', B.noSub);
    const to = String((req.body as any).plan) as PlanId; if (!PAID.includes(to)) return back(reply, '/app/billing', 'err', B.unknown);
    try {
      const pv = await changePlan(ctx.team, to);
      return back(reply, '/app/billing', 'ok', pv.kind === 'upgrade' ? B.upgraded(Tx.plans[to], eur(pv.chargeCents)) : pv.kind === 'downgrade' ? B.downFrom(Tx.plans[to], fmt(pv.effectiveAt, l)) : B.noChange);
    } catch (e: any) { if (e instanceof LimitError) return back(reply, '/app/billing', 'err', e.msg(l)); req.log.error(e); return back(reply, '/app/billing', 'err', B.changeFail); }
  });

  app.post('/app/billing/portal', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const B = tr(loc(req, ctx)).bill;
    if (ctx.role !== 'owner' || !ctx.team.stripe_customer_id) return back(reply, '/app/billing', 'err', B.noAccount);
    try { return reply.redirect(await portalUrl(ctx.team), 303); } catch (e) { req.log.error(e); return back(reply, '/app/billing', 'err', B.portalFail); }
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
