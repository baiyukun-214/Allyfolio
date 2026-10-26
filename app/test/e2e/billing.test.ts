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
      if (req.url === '/customers/ctm_1/portal-sessions') return ok({ urls: { general: { overview: 'https://portal.example.test/ov' } } });
      res.writeHead(404); res.end('{}');
    });
  } });
  Object.assign(process.env, { BILLING_PROVIDER: 'paddle', PADDLE_ENV: 'sandbox', PADDLE_API_KEY: 'pdl_sdbx_test', PADDLE_API_BASE: fake.base, PADDLE_WEBHOOK_SECRET: 'whsec_paddle_test',
    PADDLE_CLIENT_TOKEN: 'test_clienttoken', PADDLE_PRICE_STARTER: 'pri_s', PADDLE_PRICE_BUSINESS: 'pri_b', PADDLE_PRICE_AGENCY: 'pri_a', PADDLE_PRICE_ONEOFF: 'pri_o', PADDLE_DISCOUNT_EARLYBIRD: 'dsc_early' });
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
  assert.deepEqual(txCall.body.items, [{ price_id: 'pri_b', quantity: 1 }]); assert.equal(txCall.body.discount_id, 'dsc_early'); assert.equal(txCall.body.custom_data.team_id, tid);
  r = await c.post('/app/billing/checkout', { plan: 'oneoff' }, '/app/billing');
  assert.equal(r.statusCode, 303); assert.equal(r.headers.location, 'https://pay.example.test/checkout?_ptxn=txn_1');
  assert.equal(calls.filter((x) => x.path === '/transactions').at(-1)!.body.discount_id, undefined, 'no early-bird on one-off');
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
