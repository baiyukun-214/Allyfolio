import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_tests_only';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_PRICE_STARTER = 'price_s'; process.env.STRIPE_PRICE_BUSINESS = 'price_b'; process.env.STRIPE_PRICE_AGENCY = 'price_a'; process.env.STRIPE_PRICE_ONEOFF = 'price_o';
let app: any, db: any, stripe: any, applyDueDowngrades: any;
before(async () => {
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
  ({ stripe, applyDueDowngrades } = await import('../../src/lib/billing.ts'));
  db.run("INSERT INTO teams (id, name, created_at) VALUES ('t1', 'T', '2026-01-01')");
});
after(async () => app.close());
let n = 0;
const send = (type: string, object: any) => {
  const payload = JSON.stringify({ id: `evt_${++n}`, object: 'event', type, data: { object } });
  const sig = stripe().webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' });
  return app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, payload });
};
const team = () => db.get("SELECT * FROM teams WHERE id = 't1'");
const sub = (price: string, endS = 1900000000) => ({ id: 'sub_1', object: 'subscription', status: 'active', metadata: { team_id: 't1' }, items: { data: [{ id: 'si_1', price: { id: price }, current_period_start: endS - 2592000, current_period_end: endS }] } });

test('rejects bad signatures', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, payload: '{}' });
  assert.equal(r.statusCode, 400);
});
test('checkout → plan; portal upgrade immediate; downgrade deferred to period end; cancel; one-off credit; idempotent', async () => {
  let r = await send('checkout.session.completed', { object: 'checkout.session', mode: 'subscription', client_reference_id: 't1', customer: 'cus_1', subscription: 'sub_1', metadata: { kind: 'starter' } });
  assert.equal(r.statusCode, 200, r.body); assert.equal(team().plan, 'starter');
  await send('customer.subscription.updated', sub('price_b'));
  assert.equal(team().plan, 'business', 'upgrade immediate');
  const past = Math.floor(Date.now() / 1000) - 10;
  await send('customer.subscription.updated', sub('price_s', past + 86400));
  assert.equal(team().plan, 'business'); assert.equal(team().pending_plan, 'starter', 'downgrade pending');
  assert.equal(await applyDueDowngrades(), 0, 'not yet due');
  assert.equal(await applyDueDowngrades(new Date(Date.now() + 2 * 86400_000).toISOString()), 1);
  assert.equal(team().plan, 'starter');
  r = await send('checkout.session.completed', { object: 'checkout.session', mode: 'payment', payment_status: 'paid', client_reference_id: 't1', customer: 'cus_1', metadata: { kind: 'oneoff' } });
  assert.equal(team().oneoff_credits, 1);
  // replay the same event id → ignored
  const payload = JSON.stringify({ id: `evt_${n}`, object: 'event', type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'paid', client_reference_id: 't1', metadata: { kind: 'oneoff' } } } });
  r = await app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': stripe().webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' }) }, payload });
  assert.equal(r.json().result, 'duplicate'); assert.equal(team().oneoff_credits, 1);
  await send('customer.subscription.deleted', { id: 'sub_1', object: 'subscription' });
  assert.equal(team().plan, 'none');
});
