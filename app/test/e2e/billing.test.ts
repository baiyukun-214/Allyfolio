import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureServer, client } from './helpers.ts';
// Fake Paddle API (sandbox shape) – records every request.
const calls: { method: string; path: string; body: any }[] = [];
let fake: any;
const SUB = (price: string, extra: any = {}) => ({ id: 'sub_1', status: 'active', customer_id: 'ctm_1', items: [{ price: { id: price } }],
  current_billing_period: { starts_at: new Date(Date.now() - 15 * 86400_000).toISOString(), ends_at: new Date(Date.now() + 15 * 86400_000).toISOString() }, ...extra });
let envReady!: () => void; const envSet = new Promise<void>((r) => (envReady = r));
before(async () => {
  fake = await fixtureServer({ '*': (req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const body = b ? JSON.parse(b) : null; calls.push({ method: req.method!, path: req.url!, body });
      const ok = (data: any) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data })); };
      if (req.headers.authorization !== 'Bearer pdl_sdbx_test') { res.writeHead(403); return res.end('{}'); }
      if (req.url === '/transactions') return ok({ id: 'txn_1', checkout: { url: 'https://pay.example.test/checkout?_ptxn=txn_1' } });
      if (req.url === '/subscriptions/sub_1' && req.method === 'GET') return ok(SUB('pri_s'));
      if (req.url === '/subscriptions/sub_1' && req.method === 'PATCH') return ok(SUB(body.items[0].price_id));
      if (req.url === '/subscriptions/sub_1/cancel') return ok(SUB('pri_s', { scheduled_change: { action: 'cancel', effective_at: '2030-01-01T00:00:00Z' } }));
      if (req.url === '/transactions/txn_sub') return ok({ id: 'txn_sub', status: 'completed', subscription_id: 'sub_9', customer_id: 'ctm_9', custom_data: { team_id: 'tsync', kind: 'business' } });
      if (req.url === '/transactions/txn_one') return ok({ id: 'txn_one', status: 'completed', subscription_id: null, customer_id: 'ctm_9', custom_data: { team_id: 'tsync', kind: 'oneoff' }, items: [{ price: { id: 'pri_o' } }] });
      if (req.url === '/transactions/txn_wait') return ok({ id: 'txn_wait', status: 'ready', custom_data: { team_id: 'tsync' } });
      if (req.url === '/transactions/txn_other') return ok({ id: 'txn_other', status: 'completed', subscription_id: 'sub_9', custom_data: { team_id: 'someone-else' } });
      if (req.url === '/subscriptions/sub_9') return ok({ ...SUB('pri_b'), id: 'sub_9', customer_id: 'ctm_9' });
      if (/^\/subscriptions\/sub_r\d?\/cancel$/.test(req.url!)) return ok({ id: req.url!.split('/')[2], status: 'canceled' });
      if (req.url === '/customers/ctm_1/portal-sessions') return ok({ urls: { general: { overview: 'https://portal.example.test/ov' } } });
      res.writeHead(404); res.end('{}');
    });
  } });
  Object.assign(process.env, { BILLING_PROVIDER: 'paddle', PADDLE_ENV: 'sandbox', PADDLE_API_KEY: 'pdl_sdbx_test', PADDLE_API_BASE: fake.base, PADDLE_WEBHOOK_SECRET: 'whsec_paddle_test',
    PADDLE_CLIENT_TOKEN: 'test_clienttoken', PADDLE_PRICE_STARTER: 'pri_s', PADDLE_PRICE_BUSINESS: 'pri_b', PADDLE_PRICE_AGENCY: 'pri_a', PADDLE_PRICE_ONEOFF: 'pri_o', PADDLE_DISCOUNT_EARLYBIRD: 'dsc_01h8earlybird0000000000000',
    PADDLE_DISCOUNT_CODE_ID: 'dsc_01h8earlybirdcode000000000', PADDLE_DISCOUNT_CODE: 'EarlyBird30' });
  envReady();
});
let app: any, db: any, signPaddle: any, applyDueDowngrades: any;
before(async () => {
  await envSet; // hooks may overlap on newer Node 22 releases: config must be imported after the env is set
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
  ({ signPaddle } = await import('../../src/lib/billing/paddle.ts'));
  ({ applyDueDowngrades } = await import('../../src/lib/billing/index.ts'));
  db.run("INSERT INTO teams (id, name, created_at) VALUES ('t1', 'T', '2026-01-01')");
});
after(async () => { await app.close(); fake.server.close(); });
let n = 0;
const send = (event_type: string, data: any, id = `evt_${++n}`) => {
  const payload = JSON.stringify({ event_id: id, event_type, occurred_at: new Date().toISOString(), data });
  return app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', 'paddle-signature': signPaddle(payload, 'whsec_paddle_test') }, payload });
};
const team = (id = 't1') => db.get('SELECT * FROM teams WHERE id = ?', id);

test('webhook rejects bad and stale signatures', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', 'paddle-signature': 'ts=1;h1=bad' }, payload: '{}' });
  assert.equal(r.statusCode, 400);
  const payload = '{"event_id":"x","event_type":"subscription.canceled","data":{"id":"sub_1"}}';
  r = await app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', 'paddle-signature': signPaddle(payload, 'whsec_paddle_test', Math.floor(Date.now() / 1000) - 3600) }, payload });
  assert.equal(r.statusCode, 400, 'replayed old signature');
});

test('webhooks: subscribe, upgrade immediate, downgrade deferred, one-off credit, idempotent, scheduled cancel, canceled', async () => {
  let r = await send('subscription.created', { ...SUB('pri_s'), custom_data: { team_id: 't1', kind: 'starter' } });
  assert.equal(r.statusCode, 200, r.body); assert.equal(team().plan, 'starter'); assert.equal(team().billing_subscription_id, 'sub_1'); assert.equal(team().billing_customer_id, 'ctm_1');
  await send('subscription.updated', SUB('pri_b'));
  assert.equal(team().plan, 'business', 'upgrade immediate');
  await send('subscription.updated', SUB('pri_s', { current_billing_period: { starts_at: new Date(Date.now() - 29 * 86400_000).toISOString(), ends_at: new Date(Date.now() + 86400_000).toISOString() } }));
  assert.equal(team().plan, 'business'); assert.equal(team().pending_plan, 'starter', 'downgrade pending');
  assert.equal(await applyDueDowngrades(), 0, 'not yet due');
  assert.equal(await applyDueDowngrades(new Date(Date.now() + 2 * 86400_000).toISOString()), 1);
  assert.equal(team().plan, 'starter');
  r = await send('transaction.completed', { id: 'txn_9', subscription_id: null, customer_id: 'ctm_1', custom_data: { team_id: 't1', kind: 'oneoff' }, items: [{ price: { id: 'pri_o' } }] }, 'evt_oneoff');
  assert.equal(team().oneoff_credits, 1);
  r = await send('transaction.completed', { id: 'txn_9', subscription_id: null, custom_data: { team_id: 't1', kind: 'oneoff' } }, 'evt_oneoff');
  assert.equal(r.json().result, 'duplicate'); assert.equal(team().oneoff_credits, 1);
  await send('transaction.completed', { id: 'txn_10', subscription_id: 'sub_1', custom_data: { team_id: 't1', kind: 'starter' } });
  assert.equal(team().oneoff_credits, 1, 'subscription renewals are not one-off credits');
  await send('subscription.updated', SUB('pri_s', { scheduled_change: { action: 'cancel', effective_at: '2030-01-01T00:00:00Z' } }));
  assert.equal(team().cancel_at, '2030-01-01T00:00:00Z'); assert.equal(team().plan, 'starter');
  await send('subscription.past_due', SUB('pri_s', { status: 'past_due' }));
  assert.equal(team().subscription_status, 'past_due'); assert.equal(team().plan, 'starter', 'past_due keeps access');
  await send('subscription.canceled', { id: 'sub_1', status: 'canceled' });
  assert.equal(team().plan, 'none'); assert.equal(team().billing_subscription_id, null);
});

test('dashboard: checkout (overlay JSON + no-JS redirect, early-bird discount), upgrade, downgrade, cancel, portal', async () => {
  // Early-bird member
  db.run("INSERT INTO waitlist (email, token, created_at, confirmed_at, early_bird) VALUES ('owner@shop.example', 'tok', '2026-01-01', '2026-01-01', 1)");
  const c = client(app);
  await c.post('/signup', { email: 'owner@shop.example', password: 'correct horse battery' }, '/signup');
  let r = await c.req('GET', '/app/billing');
  assert.match(r.body, /cdn\.paddle\.com\/paddle\/v2\/paddle\.js/); assert.match(r.body, /data-token="test_clienttoken"/); assert.match(r.body, /Paddle\.com/);
  assert.match(r.body, /€49/);
  const csrf = await c.csrf('/app/billing');
  r = await app.inject({ method: 'POST', url: '/app/billing/checkout', headers: { cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join('; '), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, payload: `plan=business&_csrf=${encodeURIComponent(csrf)}` });
  assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().transactionId, 'txn_1');
  const txCall = calls.filter((x) => x.path === '/transactions').at(-1)!;
  const tid = db.get("SELECT t.id FROM teams t JOIN memberships m ON m.team_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = 'owner@shop.example'").id;
  assert.deepEqual(txCall.body.items, [{ price_id: 'pri_b', quantity: 1 }]); assert.equal(txCall.body.discount_id, 'dsc_01h8earlybird0000000000000'); assert.equal(txCall.body.custom_data.team_id, tid);
  r = await c.post('/app/billing/checkout', { plan: 'oneoff' }, '/app/billing');
  assert.equal(r.statusCode, 303); assert.equal(r.headers.location, 'https://pay.example.test/checkout?_ptxn=txn_1');
  assert.equal(calls.filter((x) => x.path === '/transactions').at(-1)!.body.discount_id, undefined, 'no early-bird on one-off');
  assert.doesNotMatch((await c.req('GET', '/app/billing?code=EARLYBIRD30')).body, /name="code"|Code EARLYBIRD30 applied/, 'early birds get the discount by email, no code field');
  // Subscription exists → upgrade / downgrade / cancel / portal
  db.run("UPDATE teams SET plan = 'starter', billing_subscription_id = 'sub_1', billing_customer_id = 'ctm_1' WHERE id = ?", tid);
  r = await c.post('/app/billing/change', { plan: 'business' }, '/app/billing');
  assert.match(decodeURIComponent(r.headers.location as string), /Upgraded to Business\. A prorated charge of €10 was invoiced/);
  let patch = calls.filter((x) => x.method === 'PATCH').at(-1)!;
  assert.equal(patch.body.proration_billing_mode, 'prorated_immediately'); assert.equal(patch.body.items[0].price_id, 'pri_b');
  assert.equal(team(tid).plan, 'business');
  r = await c.post('/app/billing/change', { plan: 'starter' }, '/app/billing');
  patch = calls.filter((x) => x.method === 'PATCH').at(-1)!;
  assert.equal(patch.body.proration_billing_mode, 'do_not_bill'); assert.equal(team(tid).plan, 'business'); assert.equal(team(tid).pending_plan, 'starter');
  r = await c.post('/app/billing/cancel', {}, '/app/billing');
  assert.deepEqual(calls.at(-1), { method: 'POST', path: '/subscriptions/sub_1/cancel', body: { effective_from: 'next_billing_period' } });
  r = await c.post('/app/billing/portal', {}, '/app/billing');
  assert.equal(r.headers.location, 'https://portal.example.test/ov');
});


test('post-checkout status poll: explicit successUrl, live region, status endpoint', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'poll@example.com', password: 'poll password long' }, '/signup');
  let r = await c.req('GET', '/app/billing');
  assert.match(r.body, /data-success="http:\/\/localhost:8787\/app\/billing\?paid=1"/); assert.doesNotMatch(r.body, /id="pay-status"/);
  r = await c.req('GET', '/app/billing?paid=1');
  assert.match(r.body, /id="pay-status"[^>]*role="status"[^>]*aria-live="polite"/); assert.match(r.body, /billing-status\.js/);
  r = await c.req('GET', '/app/billing/status');
  assert.equal(r.headers['cache-control'], 'no-store'); assert.deepEqual(JSON.parse(r.body), { plan: 'none', status: null, credits: 0 });
  assert.match(String((await client(app).req('GET', '/app/billing/status')).statusCode), /^30[23]$/);
});

test('return-URL sync applies a checkout without a webhook (local sandbox), idempotently, only for the own team', async () => {
  const { client } = await import('./helpers.ts');
  const c = client(app);
  await c.post('/signup', { email: 'sync@example.com', password: 'sync password long' }, '/signup');
  const uid = db.get("SELECT id FROM users WHERE email = 'sync@example.com'").id;
  db.run("INSERT INTO teams (id, name, created_at) VALUES ('tsync', 'Sync', '2026-01-01')");
  db.run("DELETE FROM memberships WHERE user_id = ?", uid);
  db.run("INSERT INTO memberships (team_id, user_id, role, created_at) VALUES ('tsync', ?, 'owner', '2026-01-01')", uid);
  let r = await c.req('GET', '/app/billing?paid=1&txn=txn_other'); assert.equal(team('tsync').plan, 'none', 'foreign transaction ignored');
  r = await c.req('GET', '/app/billing?paid=1&txn=txn_wait'); assert.match(r.body, /id="pay-status"/); assert.equal(team('tsync').plan, 'none');
  // the poll endpoint runs the same sync
  r = await c.req('GET', '/app/billing/status?txn=txn_wait'); assert.equal(JSON.parse(r.body).plan, 'none');
  r = await c.req('GET', '/app/billing/status?txn=txn_sub'); assert.equal(JSON.parse(r.body).plan, 'business');
  r = await c.req('GET', '/app/billing?paid=1&txn=txn_sub');
  assert.equal(team('tsync').plan, 'business'); assert.equal(team('tsync').billing_subscription_id, 'sub_9'); assert.match(r.body, /Payment received/);
  await c.req('GET', '/app/billing?paid=1&txn=txn_one'); await c.req('GET', '/app/billing?paid=1&txn=txn_one');
  // the webhook for the same one-off transaction arrives later: still one credit
  await send('transaction.completed', { id: 'txn_one', subscription_id: null, customer_id: 'ctm_9', custom_data: { team_id: 'tsync', kind: 'oneoff' }, items: [{ price: { id: 'pri_o' } }] });
  assert.equal(team('tsync').oneoff_credits, 1);
  assert.match((await c.req('GET', '/app/billing')).body, /txn=|paddle-config|billing\.js/);
});

test('plan_override: effective plan wins; webhooks, downgrade job and billing UI never touch it or call Paddle', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'comped@example.com', password: 'comped password long' }, '/signup');
  const tid = db.get("SELECT t.id FROM teams t JOIN memberships m ON m.team_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = 'comped@example.com'").id;
  // Billed Business via a (sandbox) subscription, admin override to Agency.
  db.run("UPDATE teams SET plan = 'business', billing_subscription_id = 'sub_c', billing_customer_id = 'ctm_c', subscription_status = 'active', current_period_end = ?, plan_override = 'agency' WHERE id = ?", new Date(Date.now() + 86400_000).toISOString(), tid);
  db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, verified_at, created_at, next_scan_at) VALUES ('sc1', ?, 'S', 'https://comped.example', 'x', '2026-01-01', '2026-01-01', '2030-01-01')", tid);
  // Entitlements use the override: 15 sites.
  let r = await c.req('GET', '/app');
  assert.match(r.body, /Agency plan · 1\/15 sites/);
  const { planOf, withEffectivePlan } = await import('../../src/lib/plans.ts');
  assert.equal(planOf(withEffectivePlan(team(tid)).plan).sites, 15);
  // Billing page: complimentary, no checkout/change/cancel/portal, no Paddle.js.
  r = await c.req('GET', '/app/billing');
  assert.match(r.body, /Complimentary plan \(admin\)/);
  assert.doesNotMatch(r.body, /billing\/(checkout|change|cancel|portal)|paddle\.js|data-checkout/);
  const before = calls.length;
  for (const [path, form] of [['/app/billing/checkout', { plan: 'starter' }], ['/app/billing/change', { plan: 'starter' }], ['/app/billing/cancel', {}], ['/app/billing/portal', {}]] as const) {
    r = await c.post(path, form as any);
    assert.match(decodeURIComponent(String(r.headers.location ?? r.body)), /Complimentary plan/, path);
  }
  await c.req('GET', '/app/billing?txn=txn_sub'); // return-URL sync is skipped too
  assert.equal(calls.length, before, 'no Paddle API calls for a comped team');
  // Renewal webhook reporting a lower plan, then the downgrade job, then cancel: effective plan stays Agency, monitoring stays on.
  await send('subscription.updated', { ...SUB('pri_s'), id: 'sub_c', customer_id: 'ctm_c', custom_data: { team_id: tid } });
  assert.equal(await applyDueDowngrades(new Date(Date.now() + 10 * 86400_000).toISOString()) >= 0, true);
  assert.equal(withEffectivePlan(team(tid)).plan, 'agency');
  await send('subscription.canceled', { id: 'sub_c', status: 'canceled' });
  assert.equal(team(tid).plan_override, 'agency'); assert.equal(withEffectivePlan(team(tid)).plan, 'agency');
  assert.equal(db.get("SELECT next_scan_at FROM sites WHERE id = 'sc1'").next_scan_at, '2030-01-01', 'schedule untouched');
  r = await c.req('GET', '/app/billing/status'); assert.equal(r.json().plan, 'agency');
  // Removing the override restores normal billing behaviour.
  db.run('UPDATE teams SET plan_override = NULL WHERE id = ?', tid);
  assert.equal(withEffectivePlan(team(tid)).plan, team(tid).plan);
});

const adj = (o: any) => ({ id: 'adj_1', action: 'refund', status: 'approved', type: 'full', transaction_id: 'txn_r', subscription_id: 'sub_r', customer_id: 'ctm_r',
  items: [{ item_id: 'txnitm_1', type: 'full', amount: '3900' }], ...o });
test('refunds: full refund ends the plan immediately (once), partial keeps it, pending ignored, late active updates ignored', async () => {
  db.run("INSERT INTO teams (id, name, created_at) VALUES ('tr', 'Refund', '2026-01-01')");
  db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, verified_at, created_at, next_scan_at) VALUES ('sr1', 'tr', 'S', 'https://refund.example', 'x', '2026-01-01', '2026-01-01', '2030-01-01')");
  await send('subscription.created', { ...SUB('pri_b'), id: 'sub_r', customer_id: 'ctm_r', custom_data: { team_id: 'tr', kind: 'business' } });
  assert.equal(team('tr').plan, 'business');
  const cancels = () => calls.filter((x) => x.path === '/subscriptions/sub_r/cancel');
  // partial refund: plan stays
  let r = await send('adjustment.created', adj({ id: 'adj_p', type: 'partial', items: [{ item_id: 'txnitm_1', type: 'partial', amount: '1000' }] }));
  assert.equal(r.statusCode, 200, r.body); assert.equal(team('tr').plan, 'business'); assert.equal(cancels().length, 0);
  // full refund still awaiting approval: nothing yet
  await send('adjustment.created', adj({ id: 'adj_f', status: 'pending_approval' }));
  assert.equal(team('tr').plan, 'business');
  // approved (adjustment.updated): plan ends now, schedule stops, Paddle subscription cancelled immediately
  r = await send('adjustment.updated', adj({ id: 'adj_f' }));
  assert.equal(r.statusCode, 200, r.body);
  const t = team('tr');
  assert.deepEqual([t.plan, t.subscription_status, t.billing_subscription_id, t.pending_plan, t.cancel_at], ['none', 'canceled', null, null, null]);
  assert.equal(db.get("SELECT next_scan_at FROM sites WHERE id = 'sr1'").next_scan_at, null);
  assert.equal(cancels().length, 1); assert.deepEqual(cancels()[0].body, { effective_from: 'immediately' });
  // the same adjustment again (retry with a new event id, or a later update): applied once
  await send('adjustment.updated', adj({ id: 'adj_f' }));
  await send('adjustment.updated', adj({ id: 'adj_f' }), 'evt_same'); r = await send('adjustment.updated', adj({ id: 'adj_f' }), 'evt_same');
  assert.equal(r.json().result, 'duplicate'); assert.equal(cancels().length, 1);
  // late "active" update and the resulting canceled event for the refunded subscription: plan stays ended
  await send('subscription.updated', { ...SUB('pri_b'), id: 'sub_r', customer_id: 'ctm_r', custom_data: { team_id: 'tr', kind: 'business' } });
  assert.equal(team('tr').plan, 'none'); assert.equal(team('tr').billing_subscription_id, null);
  await send('subscription.canceled', { id: 'sub_r', status: 'canceled', custom_data: { team_id: 'tr' } });
  assert.equal(team('tr').plan, 'none');
  // chargeback counts as a full refund; a rejected refund does nothing
  db.run("UPDATE teams SET plan = 'starter', billing_subscription_id = 'sub_r2', subscription_status = 'active' WHERE id = 'tr'");
  await send('adjustment.created', adj({ id: 'adj_rej', subscription_id: 'sub_r2', status: 'rejected' }));
  assert.equal(team('tr').plan, 'starter');
  await send('adjustment.created', adj({ id: 'adj_cb', action: 'chargeback', subscription_id: 'sub_r2' }));
  assert.equal(team('tr').plan, 'none'); assert.equal(calls.filter((x) => x.path === '/subscriptions/sub_r2/cancel').length, 1);
  // credits (account credit, not money back) are not refunds
  db.run("UPDATE teams SET plan = 'starter', billing_subscription_id = 'sub_r3', subscription_status = 'active' WHERE id = 'tr'");
  await send('adjustment.created', adj({ id: 'adj_cr', action: 'credit', subscription_id: 'sub_r3' }));
  assert.equal(team('tr').plan, 'starter');
});

test('refunds: full refund of a one-off takes its credit back once; partial and unknown transactions do not', async () => {
  db.run("INSERT INTO teams (id, name, created_at, billing_customer_id) VALUES ('to', 'Oneoff', '2026-01-01', 'ctm_o')");
  for (const id of ['txn_o1', 'txn_o2']) await send('transaction.completed', { id, subscription_id: null, customer_id: 'ctm_o', custom_data: { team_id: 'to', kind: 'oneoff' }, items: [{ price: { id: 'pri_o' } }] });
  assert.equal(team('to').oneoff_credits, 2);
  const one = (o: any) => adj({ subscription_id: null, customer_id: 'ctm_o', ...o });
  await send('adjustment.created', one({ id: 'adj_o_p', transaction_id: 'txn_o1', type: 'partial' }));
  assert.equal(team('to').oneoff_credits, 2, 'partial keeps the credit');
  await send('adjustment.created', one({ id: 'adj_o_f', transaction_id: 'txn_o1' }));
  await send('adjustment.updated', one({ id: 'adj_o_f', transaction_id: 'txn_o1' }));
  assert.equal(team('to').oneoff_credits, 1, 'one credit back, once');
  await send('adjustment.created', one({ id: 'adj_o_x', transaction_id: 'txn_unknown' }));
  assert.equal(team('to').oneoff_credits, 1, 'transaction that never granted a credit');
  db.run("UPDATE teams SET oneoff_credits = 0 WHERE id = 'to'"); // credit already used for a scan
  await send('adjustment.created', one({ id: 'adj_o_f2', transaction_id: 'txn_o2' }));
  assert.equal(team('to').oneoff_credits, 0, 'never negative');
});

test('discount code: field for non-early-bird owners, validated, sent only with subscription checkouts', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'code@example.com', password: 'code password long' }, '/signup');
  let r = await c.req('GET', '/app/billing');
  assert.match(r.body, /<label for="code">Discount code<\/label>/); assert.match(r.body, /aria-describedby="code-hint"/);
  r = await c.req('GET', '/app/billing?code=WRONG1');
  assert.match(r.body, /role="alert">This discount code is not valid\./); assert.doesNotMatch(r.body, /name="code" value=/);
  r = await c.req('GET', '/app/billing?code=earlybird30');
  assert.match(r.body, /Code EARLYBIRD30 applied: 30% off your first 12 months/);
  assert.equal((r.body.match(/<input type="hidden" name="code" value="earlybird30">/g) ?? []).length, 3, 'on the three plan buttons, not the one-off');
  const checkout = async (form: Record<string, string>) => { await c.post('/app/billing/checkout', form, '/app/billing'); return calls.filter((x) => x.path === '/transactions').at(-1)!.body; };
  assert.equal((await checkout({ plan: 'starter', code: 'earlybird30' })).discount_id, 'dsc_01h8earlybirdcode000000000');
  assert.equal((await checkout({ plan: 'starter', code: 'nope' })).discount_id, undefined);
  assert.equal((await checkout({ plan: 'starter' })).discount_id, undefined);
  assert.equal((await checkout({ plan: 'oneoff', code: 'EARLYBIRD30' })).discount_id, undefined, 'never on the one-off');
});

test('plan carry: /signup?plan= → signup/login → that plan\'s checkout on Billing', async () => {
  const c = client(app);
  let r = await c.req('GET', '/signup?plan=agency&lang=en');
  assert.match(r.body, /After you sign up, you go straight to checkout for Agency\./); assert.equal(c.jar.get('af_plan'), 'agency');
  r = await c.post('/signup', { email: 'carry@example.com', password: 'carry password long' }, '/signup');
  assert.equal(r.headers.location, '/app/billing?plan=agency#chosen');
  r = await c.req('GET', '/app/billing?plan=agency');
  assert.match(r.body, /<h2[^>]*>You picked Agency<\/h2>/);
  assert.match(r.body, /id="chosen".*?name="plan" value="agency".*?Continue to checkout/s);
  assert.equal(c.jar.get('af_plan'), undefined, 'cookie cleared once used');
  // one-off, and when already signed in
  r = await c.req('GET', '/signup?plan=oneoff'); assert.equal(r.statusCode, 302); assert.equal(r.headers.location, '/app/billing?plan=oneoff#chosen');
  r = await c.req('GET', '/app/billing?plan=oneoff'); assert.match(r.body, /You picked One-off report/); assert.match(r.body, /id="chosen".*?value="oneoff"/s);
  // unknown plans are ignored
  const d = client(app);
  r = await d.req('GET', '/signup?plan=enterprise'); assert.doesNotMatch(r.body, /straight to checkout/); assert.equal(d.jar.get('af_plan'), undefined);
  // login keeps the carry too (existing account clicking a pricing button)
  await c.post('/logout', {}, '/app');
  await c.req('GET', '/signup?plan=business');
  r = await c.post('/login', { email: 'carry@example.com', password: 'carry password long' }, '/login');
  assert.equal(r.headers.location, '/app/billing?plan=business#chosen');
  // a team that already has this subscription is not offered it again
  db.run("UPDATE teams SET plan = 'business', billing_subscription_id = 'sub_x' WHERE id = (SELECT team_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'carry@example.com')");
  assert.doesNotMatch((await c.req('GET', '/app/billing?plan=business')).body, /id="chosen"/);
  // Chinese
  const z = client(app);
  r = await z.req('GET', '/signup?plan=starter&lang=zh-CN'); assert.match(r.body, /注册后将直接进入入门版的结账页面/);
});
