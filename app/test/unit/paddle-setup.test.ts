import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPaddleSetup, updateEnvFile } from '../../src/lib/billing/paddleSetup.ts';

function fakePaddle() {
  const db: Record<string, any[]> = { products: [], prices: [], discounts: [], 'notification-settings': [] };
  let n = 0; const posts: string[] = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const u = new URL(req.url!, 'http://x'); const [, coll, id] = u.pathname.split('/'); const body = b ? JSON.parse(b) : {};
      const send = (code: number, j: any) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.headers.authorization !== 'Bearer pdl_sdbx_apikey_SECRET') return send(403, { error: { code: 'forbidden' } });
      if (req.method === 'GET') {
        let rows = db[coll].filter((r) => (!u.searchParams.get('status') || r.status === u.searchParams.get('status')) && (!u.searchParams.get('product_id') || r.product_id === u.searchParams.get('product_id')));
        return send(200, { data: rows, meta: { pagination: { has_more: false } } });
      }
      if (req.method === 'POST') {
        posts.push(coll); const pre = { products: 'pro', prices: 'pri', discounts: 'dsc', 'notification-settings': 'ntfset' }[coll];
        const row = { id: `${pre}_${++n}`, status: 'active', ...body, ...(coll === 'notification-settings' ? { endpoint_secret_key: 'pdl_ntfset_SECRETKEY', subscribed_events: body.subscribed_events.map((name: string) => ({ name })), active: true } : {}) };
        db[coll].push(row); return send(201, { data: row });
      }
      if (req.method === 'PATCH') { const row = db[coll].find((r) => r.id === id); Object.assign(row, body); return send(200, { data: row }); }
    });
  });
  return { server, db, posts };
}

test('updateEnvFile replaces in place and appends missing keys', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
  writeFileSync(p, '# mine\nPADDLE_ENV=sandbox\nPADDLE_PRICE_STARTER=old\nOTHER=1');
  updateEnvFile(p, { PADDLE_PRICE_STARTER: 'pri_new', PADDLE_DISCOUNT_EARLYBIRD: 'dsc_1' });
  const s = readFileSync(p, 'utf8');
  assert.match(s, /^# mine\nPADDLE_ENV=sandbox\nPADDLE_PRICE_STARTER=pri_new\nOTHER=1\n/); assert.match(s, /PADDLE_DISCOUNT_EARLYBIRD=dsc_1/);
});

test('paddle setup is idempotent, writes .env and never prints secrets', async () => {
  const f = fakePaddle(); await new Promise<void>((r) => f.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(f.server.address() as any).port}`;
  const p = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
  writeFileSync(p, 'PADDLE_ENV=sandbox\nPADDLE_API_KEY=pdl_sdbx_apikey_SECRET\nPADDLE_CLIENT_TOKEN=test_tok\n');
  const out: string[] = []; const log = (s: string) => out.push(s);
  try {
    const r1 = await runPaddleSetup({ apiKey: 'pdl_sdbx_apikey_SECRET', apiBase: base, envPath: p, webhookUrl: 'https://abc.trycloudflare.com/api/billing/webhook', log });
    assert.equal(f.db.products.length, 4); assert.equal(f.db.prices.length, 4); assert.equal(f.db.discounts.length, 1); assert.equal(f.db['notification-settings'].length, 1);
    const amounts = Object.fromEntries(f.db.prices.map((x) => [x.custom_data.allyfolio_key, [x.unit_price.amount, x.unit_price.currency_code, x.billing_cycle?.interval ?? null]]));
    assert.deepEqual(amounts, { starter: ['1900', 'EUR', 'month'], business: ['3900', 'EUR', 'month'], agency: ['9900', 'EUR', 'month'], oneoff: ['4900', 'EUR', null] });
    const d = f.db.discounts[0];
    assert.deepEqual([d.type, d.amount, d.recur, d.maximum_recurring_intervals, d.usage_limit, d.enabled_for_checkout], ['percentage', '30', true, 12, 100, false]);
    assert.deepEqual(d.restrict_to.sort(), [r1.env.PADDLE_PRICE_STARTER, r1.env.PADDLE_PRICE_BUSINESS, r1.env.PADDLE_PRICE_AGENCY].sort());
    const env = readFileSync(p, 'utf8');
    assert.match(env, /^PADDLE_ENV=sandbox\nPADDLE_API_KEY=pdl_sdbx_apikey_SECRET\nPADDLE_CLIENT_TOKEN=test_tok\n/, 'existing lines untouched');
    assert.match(env, new RegExp(`PADDLE_PRICE_ONEOFF=${r1.env.PADDLE_PRICE_ONEOFF}`)); assert.match(env, /PADDLE_WEBHOOK_SECRET=pdl_ntfset_SECRETKEY/);
    // second run: nothing new
    const before = f.posts.length;
    const r2 = await runPaddleSetup({ apiKey: 'pdl_sdbx_apikey_SECRET', apiBase: base, envPath: p, webhookUrl: 'https://abc.trycloudflare.com/api/billing/webhook', log });
    assert.equal(f.posts.length, before, 'no POST on re-run'); assert.deepEqual(r2.env, r1.env);
    assert.equal((readFileSync(p, 'utf8').match(/PADDLE_PRICE_STARTER=/g) ?? []).length, 1, 'no duplicate lines');
    // price change (e.g. €39 → €49 one-off) archives the stale price and creates a new one
    f.db.prices.find((x) => x.custom_data.allyfolio_key === 'oneoff').unit_price.amount = '3900';
    const r3 = await runPaddleSetup({ apiKey: 'pdl_sdbx_apikey_SECRET', apiBase: base, envPath: p, log });
    assert.notEqual(r3.env.PADDLE_PRICE_ONEOFF, r1.env.PADDLE_PRICE_ONEOFF); assert.equal(f.db.prices.filter((x) => x.status === 'archived').length, 1);
    const printed = out.join('\n');
    assert.doesNotMatch(printed, /pdl_ntfset_SECRETKEY|apikey_SECRET|test_tok/); assert.match(printed, /PADDLE_WEBHOOK_SECRET=\(written to \.env, hidden\)/); assert.match(printed, /PADDLE_PRICE_STARTER=pro_|PADDLE_PRICE_STARTER=pri_/);
    await assert.rejects(runPaddleSetup({ apiKey: 'pdl_sdbx_apikey_SECRET', apiBase: base, envPath: p, webhookUrl: 'http://localhost:8787/api/billing/webhook', log }), /public https/);
  } finally { f.server.close(); }
});
