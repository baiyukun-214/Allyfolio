import { get } from '../db.ts';
import type { FastifyInstance } from 'fastify';
import { html } from '../lib/html.ts';
import { csrfField } from '../lib/csrf.ts';
import { PLANS, PAID, planOf, ONE_OFF, rank, LimitError, type PlanId } from '../lib/plans.ts';
import { provider, syncCheckout, changePlan, cancelSubscription, applyBillingEvents, WebhookSignatureError, type Purchase } from '../lib/billing/index.ts';
import { paddleLocale } from '../lib/billing/paddle.ts';
import { isEarlyBird } from '../lib/waitlist.ts';
import { requireUser, render, back, loc } from './guard.ts';
import { fmt } from './monitoring.ts';
import { t as tr } from '../i18n.ts';
const eur = (c: number) => `€${(c / 100).toFixed(0)}`;

export async function billingRoutes(app: FastifyInstance) {
  app.get('/app/billing', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return;
    // Return from Paddle checkout: read the transaction from the Paddle API (works without a reachable webhook, e.g. local sandbox).
    let flash: { kind: 'ok' | 'error'; msg: string } | undefined;
    const txn = String((req.query as any).txn ?? '');
    if (txn && ctx.role === 'owner') {
      const st = await syncCheckout(ctx.team, txn).catch((e) => { req.log.warn(e, 'checkout sync failed'); return 'pending' as const; });
      if (st === 'pending') flash = { kind: 'ok', msg: tr(loc(req, ctx)).bill.processing };
      ctx.team = get<any>('SELECT * FROM teams WHERE id = ?', ctx.team.id);
    }
    const t = ctx.team, plan = planOf(t.plan), owner = ctx.role === 'owner';
    const prov = await provider(); const ready = !!prov?.configured(); const client = ready ? prov!.clientConfig() : null;
    const eb = isEarlyBird(ctx.user.email) && !t.billing_subscription_id;
    const l = loc(req, ctx), Tx = tr(l), B = Tx.bill; const pn = (id: string) => Tx.plans[id] ?? planOf(id).name;
    const pend = t.pending_plan ? B.pending(pn(t.pending_plan), pn(plan.id)) : null;
    const buy = (what: Purchase, label: string, cls: string) => html`<form method="post" action="/app/billing/checkout" data-checkout>${csrfField(req)}<input type="hidden" name="plan" value="${what}">
      <button class="btn ${cls}" type="submit" ${ready ? '' : 'disabled'}>${label}</button></form>`;
    return render(reply, ctx, { title: B.title, current: '/app/billing', ...(flash ? { flash } : {}), body: html`
      <h1>${B.title}</h1>
      ${!ready ? html`<p class="alert alert-error" role="note">${B.notConfigured}</p>` : ''}
      <div class="card"><p class="muted small">${B.current}</p><p class="stat">${pn(plan.id)}</p>
        ${t.subscription_status ? html`<p class="small muted">${B.status}: ${B.statuses[t.subscription_status] ?? t.subscription_status}${t.current_period_end ? html` · ${B.periodEnds} ${fmt(t.current_period_end, l)}` : ''}</p>` : ''}
        ${pend ? html`<p class="notice">${pend[0]}<strong>${pend[1]}</strong>${pend[2]}</p>` : ''}
        ${t.cancel_at ? html`<p class="notice">${B.cancelsOn(fmt(t.cancel_at, l))}</p>` : ''}
        ${t.oneoff_credits ? html`<p class="small">${B.credits}: <strong>${t.oneoff_credits}</strong></p>` : ''}
        <div class="row">
        ${owner && t.billing_customer_id && ready ? html`<form method="post" action="/app/billing/portal">${csrfField(req)}<button class="btn btn-secondary" type="submit">${B.portal}</button></form>` : ''}
        ${owner && t.billing_subscription_id && !t.cancel_at && ready ? html`<form method="post" action="/app/billing/cancel">${csrfField(req)}<button class="btn btn-danger" type="submit">${B.cancel}</button></form>` : ''}
        </div>
        ${owner && t.billing_subscription_id && !t.cancel_at ? html`<p class="small muted">${B.cancelHint}</p>` : ''}
      </div>
      ${eb ? html`<p class="notice"><strong>${B.earlyH}</strong> ${B.early}</p>` : ''}
      <h2>${B.plans}</h2>
      <p class="small muted">${B.terms}</p>
      <div class="grid g3">${PAID.map((id) => { const p = PLANS[id]; const cur = t.plan === id; return html`
        <div class="card"><h3>${pn(id)}</h3><p class="stat">${eur(p.priceCents)}<span class="small muted"> ${B.perMonth}</span></p>
          <ul class="small"><li>${B.sitesN(p.sites)}</li><li>${B.pagesN(p.pagesPerSite)}</li><li>${p.frequency === 'daily' ? B.daily : B.weekly}</li><li>${B.history(p.retentionMonths)}</li>${p.pdf ? html`<li>${B.pdf}</li>` : ''}${p.whiteLabel ? html`<li>${B.wl}</li>` : ''}<li>${B.seatsN(p.seats)}</li></ul>
          ${cur ? html`<p class="pill ok">${B.currentPill}</p>` : !owner ? '' : t.billing_subscription_id
            ? html`<form method="post" action="/app/billing/change">${csrfField(req)}<input type="hidden" name="plan" value="${id}">
              <button class="btn ${rank(id) > rank(t.plan) ? 'btn-primary' : 'btn-secondary'}" type="submit" ${ready ? '' : 'disabled'}>${rank(id) > rank(t.plan) ? B.upgrade : B.downgrade} <span class="sr-only">${pn(id)}</span></button></form>`
            : buy(id, B.choose + ' ' + pn(id), 'btn-primary')}
        </div>`; })}</div>
      <h2>${B.oneoffH}</h2>
      <div class="card row between"><p style="margin:0">${B.oneoff(eur(ONE_OFF.priceCents))}</p>${owner ? buy('oneoff', B.buyOneoff, 'btn-secondary') : ''}</div>
      <p class="small muted">${B.mor}</p>
      ${client ? html`<div id="paddle-config" hidden data-token="${client.token}" data-env="${client.environment}" data-locale="${paddleLocale(l)}" data-success="/app/billing?paid=1" data-email="${ctx.user.email}"></div>
        <script src="${client.script}" defer></script><script src="/static/billing.js" defer></script>` : ''}` });
  });

  app.post('/app/billing/checkout', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const B = tr(loc(req, ctx)).bill;
    const wantsJson = String(req.headers.accept ?? '').includes('application/json');
    const fail = (msg: string, code = 400) => wantsJson ? reply.code(code).send({ error: msg }) : back(reply, '/app/billing', 'err', msg);
    if (ctx.role !== 'owner') return fail(B.ownerOnly, 403);
    const what = String((req.body as any).plan) as Purchase;
    if (what !== 'oneoff' && !PAID.includes(what as PlanId)) return fail(B.unknown);
    if (what !== 'oneoff' && ctx.team.billing_subscription_id) return fail(B.hasSub);
    const prov = await provider(); if (!prov?.configured()) return fail(B.notConfigured, 503);
    try {
      const co = await prov.checkout(ctx.team, ctx.user.email, what, { earlyBird: isEarlyBird(ctx.user.email), locale: loc(req, ctx) });
      if (wantsJson) return { transactionId: co.transactionId };
      if (co.url) return reply.redirect(co.url, 303); // Paddle's hosted checkout (default payment link) when JS is off
      return fail(B.checkoutFail, 502);
    } catch (e: any) { req.log.error(e); return fail(B.checkoutFail, 502); }
  });

  app.post('/app/billing/change', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const l = loc(req, ctx), Tx = tr(l), B = Tx.bill;
    if (ctx.role !== 'owner' || !ctx.team.billing_subscription_id) return back(reply, '/app/billing', 'err', B.noSub);
    const to = String((req.body as any).plan) as PlanId; if (!PAID.includes(to)) return back(reply, '/app/billing', 'err', B.unknown);
    try {
      const pv = await changePlan(ctx.team, to);
      return back(reply, '/app/billing', 'ok', pv.kind === 'upgrade' ? B.upgraded(Tx.plans[to], eur(pv.chargeCents)) : pv.kind === 'downgrade' ? B.downFrom(Tx.plans[to], fmt(pv.effectiveAt, l)) : B.noChange);
    } catch (e: any) { if (e instanceof LimitError) return back(reply, '/app/billing', 'err', e.msg(l)); req.log.error(e); return back(reply, '/app/billing', 'err', B.changeFail); }
  });

  app.post('/app/billing/cancel', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const l = loc(req, ctx), B = tr(l).bill;
    if (ctx.role !== 'owner' || !ctx.team.billing_subscription_id) return back(reply, '/app/billing', 'err', B.noSub);
    try { await cancelSubscription(ctx.team, 'period_end'); return back(reply, '/app/billing', 'ok', B.canceled); }
    catch (e) { req.log.error(e); return back(reply, '/app/billing', 'err', B.changeFail); }
  });

  app.post('/app/billing/portal', async (req, reply) => {
    const ctx = requireUser(req, reply); if (!ctx) return; const B = tr(loc(req, ctx)).bill;
    if (ctx.role !== 'owner' || !ctx.team.billing_customer_id) return back(reply, '/app/billing', 'err', B.noAccount);
    try { return reply.redirect(await (await provider())!.portalUrl(ctx.team), 303); } catch (e) { req.log.error(e); return back(reply, '/app/billing', 'err', B.portalFail); }
  });
}

/** Separate plugin so the webhook gets the raw body for signature checks. */
export async function billingWebhook(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.post('/api/billing/webhook', async (req, reply) => {
    const prov = await provider();
    if (!prov?.configured()) return reply.code(503).send({ error: 'billing not configured' });
    let parsed;
    try { parsed = prov.parseWebhook(req.body as Buffer, req.headers as any); }
    catch (e) { if (e instanceof WebhookSignatureError) return reply.code(400).send({ error: 'invalid signature' }); req.log.error(e); return reply.code(400).send({ error: 'bad payload' }); }
    return { received: true, result: applyBillingEvents(parsed.id, parsed.type, parsed.events) };
  });
}
