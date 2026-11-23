import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureServer, client } from './helpers.ts';

const calls: { method: string; path: string }[] = [];
let fake: any;
let envReady!: () => void; const envSet = new Promise<void>((r) => (envReady = r));

before(async () => {
  fake = await fixtureServer({ '*': (req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      calls.push({ method: req.method!, path: req.url! });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { id: 'txn_should_not_exist', checkout: { url: 'https://pay.example.test/checkout' } } }));
    });
  } });
  // Paddle is fully configured; checkout stays off because BILLING_CHECKOUT_ENABLED is not true.
  Object.assign(process.env, { BILLING_PROVIDER: 'paddle', PADDLE_ENV: 'sandbox', PADDLE_API_KEY: 'pdl_sdbx_test', PADDLE_API_BASE: fake.base, PADDLE_WEBHOOK_SECRET: 'whsec_paddle_test',
    PADDLE_CLIENT_TOKEN: 'test_clienttoken', PADDLE_PRICE_STARTER: 'pri_s', PADDLE_PRICE_BUSINESS: 'pri_b', PADDLE_PRICE_AGENCY: 'pri_a', PADDLE_PRICE_ONEOFF: 'pri_o' });
  delete process.env.BILLING_CHECKOUT_ENABLED;
  envReady();
});

let app: any, db: any;
before(async () => {
  await envSet;
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
});
after(async () => { await app.close(); fake.server.close(); });

test('login and signup stay open when checkout is closed', async () => {
  for (const path of ['/login', '/signup']) {
    const r = await app.inject({ method: 'GET', url: path });
    assert.equal(r.statusCode, 200, path);
  }
});

test('new account: dashboard and billing describe the limit without offering checkout', async () => {
  const c = client(app);
  const r0 = await c.post('/signup', { email: 'closed@example.com', password: 'closed password long' }, '/signup');
  assert.equal(r0.statusCode, 303);
  assert.equal(r0.headers.location, '/app');
  const dash = await c.req('GET', '/app');
  assert.match(dash.body, /No scan plan on this account/);
  assert.match(dash.body, /does not include scheduled scans or PDF reports/);
  assert.match(dash.body, /href="http:\/\/localhost:4321\/free-scan">Run a free one-page scan/);
  assert.doesNotMatch(dash.body, /choose a plan|buy a one-off|\/app\/billing\/checkout/);
  const bill = await c.req('GET', '/app/billing');
  assert.match(bill.body, /Paid plans are not yet available/);
  assert.match(bill.body, /Scheduled scans and paid reports are not included/);
  assert.match(bill.body, /€19/);
  assert.match(bill.body, /€39/);
  assert.match(bill.body, /€99/);
  assert.match(bill.body, /€49/);
  assert.match(bill.body, /Starter/);
  assert.match(bill.body, /Weekly scans|Up to 100 pages/);
  assert.doesNotMatch(bill.body, /action="\/app\/billing\/checkout"|action="\/app\/billing\/change"|id="paddle-config"|billing\.js|id="chosen"|Discount code/);
  const n = calls.length;
  const csrf = await c.csrf('/app');
  const co = await app.inject({ method: 'POST', url: '/app/billing/checkout', headers: { cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join('; '), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, payload: `plan=starter&_csrf=${encodeURIComponent(csrf)}` });
  assert.equal(co.statusCode, 403);
  assert.match(co.body, /New purchases and plan changes are not available/);
  assert.equal(calls.length, n, 'Paddle was not called');
});

test('plan carry does not promise checkout, and existing subscribers can still cancel', async () => {
  const c = client(app);
  let r = await c.req('GET', '/signup?plan=agency&lang=en');
  assert.doesNotMatch(r.body, /straight to checkout/);
  assert.equal(c.jar.get('af_plan'), undefined);
  r = await c.post('/signup', { email: 'carry-closed@example.com', password: 'carry password long' }, '/signup');
  assert.equal(r.headers.location, '/app');
  const tid = db.get("SELECT team_id AS id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'carry-closed@example.com'").id;
  db.run("UPDATE teams SET plan='starter', billing_subscription_id='sub_closed', billing_customer_id='ctm_closed', subscription_status='active' WHERE id = ?", tid);
  const bill = await c.req('GET', '/app/billing');
  assert.match(bill.body, /action="\/app\/billing\/cancel"/);
  assert.match(bill.body, /action="\/app\/billing\/portal"/);
  assert.doesNotMatch(bill.body, /action="\/app\/billing\/change"|action="\/app\/billing\/checkout"/);
  const ch = await c.post('/app/billing/change', { plan: 'business' }, '/app/billing');
  assert.match(decodeURIComponent(String(ch.headers.location ?? ch.body)), /New purchases and plan changes are not available/);
});

test('GET /pay does not open Paddle checkout when billing is closed', async () => {
  const r = await app.inject({ method: 'GET', url: '/pay?_ptxn=txn_abc123' });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /New purchases are not available/);
  assert.doesNotMatch(r.body, /id="paddle-pay"|pay\.js|Opening secure checkout/);
});
