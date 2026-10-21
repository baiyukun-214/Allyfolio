import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureServer, client } from './helpers.ts';
const calls: { method: string; path: string; body: any }[] = [];
let fake: any, app: any, db: any, sentMail: any[], acct: any;
before(async () => {
  fake = await fixtureServer({ '*': (req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      calls.push({ method: req.method!, path: req.url!, body: b ? JSON.parse(b) : null });
      if (req.url === '/subscriptions/sub_fail/cancel') { res.writeHead(500); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: { id: 'sub_x', status: 'canceled', items: [] } }));
    });
  } });
  Object.assign(process.env, { BILLING_PROVIDER: 'paddle', PADDLE_ENV: 'sandbox', PADDLE_API_KEY: 'pdl_sdbx_test', PADDLE_API_BASE: fake.base, PADDLE_WEBHOOK_SECRET: 'whsec_x', PADDLE_PRICE_STARTER: 'pri_s', PADDLE_PRICE_BUSINESS: 'pri_b', PADDLE_PRICE_AGENCY: 'pri_a', PADDLE_PRICE_ONEOFF: 'pri_o' });
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
  ({ sentMail } = await import('../../src/lib/mailer.ts'));
  acct = await import('../../src/lib/account.ts');
});
after(async () => { await app.close(); fake.server.close(); });
const resetLink = () => sentMail.at(-1).text.match(/\/reset\?token=[\w-]+/)[0];
const userId = (email: string) => db.get('SELECT id FROM users WHERE email = ?', email)?.id;

test('forgot/reset: no enumeration, single use, sessions invalidated, expiry', async () => {
  const a = client(app), b = client(app);
  await a.post('/signup', { email: 'reset@example.com', password: 'original password 1' }, '/signup');
  await b.post('/login', { email: 'reset@example.com', password: 'original password 1' }, '/login');
  assert.equal((await b.req('GET', '/app')).statusCode, 200);
  assert.match((await client(app).req('GET', '/login')).body, /href="\/forgot"/);
  const anon = client(app); const before = sentMail.length;
  let r = await anon.post('/forgot', { email: 'nobody@example.com' }, '/forgot');
  const unknownBody = r.body; assert.equal(sentMail.length, before, 'no mail for unknown address');
  r = await anon.post('/forgot', { email: 'reset@example.com' }, '/forgot');
  assert.equal(r.body.replace(/name="_csrf" value="[^"]+"/g, ''), unknownBody.replace(/name="_csrf" value="[^"]+"/g, ''), 'same response either way');
  const link = resetLink(); assert.match(sentMail.at(-1).text, /60 minutes/);
  assert.equal(db.get('SELECT COUNT(*) n FROM password_resets WHERE token_hash = ?', link.split('=')[1]).n, 0, 'token stored hashed only');
  r = await anon.req('GET', link); assert.equal(r.statusCode, 200);
  r = await anon.post('/reset', { token: link.split('=')[1], password: 'short' }, link); assert.equal(r.statusCode, 400);
  r = await anon.post('/reset', { token: link.split('=')[1], password: 'brand new password 2' }, link);
  assert.equal(r.statusCode, 200); assert.match(r.body, /password was changed/i);
  assert.match(sentMail.at(-1).subject, /password was changed/i);
  // single use
  r = await anon.req('GET', link); assert.equal(r.statusCode, 400);
  r = await anon.post('/reset', { token: link.split('=')[1], password: 'third password here' }, '/forgot'); assert.equal(r.statusCode, 400);
  // every session signed out
  for (const x of [a, b]) assert.match(String((await x.req('GET', '/app')).statusCode), /^30[23]$/);
  r = await client(app).post('/login', { email: 'reset@example.com', password: 'original password 1' }, '/login'); assert.notEqual(r.headers.location, '/app');
  r = await client(app).post('/login', { email: 'reset@example.com', password: 'brand new password 2' }, '/login'); assert.equal(r.headers.location, '/app');
  // expiry + a newer token revokes an older one
  const expired = acct.createPasswordReset(userId('reset@example.com'), -1000);
  assert.equal((await anon.req('GET', '/reset?token=' + expired)).statusCode, 400);
  const t1 = acct.createPasswordReset(userId('reset@example.com')); const t2 = acct.createPasswordReset(userId('reset@example.com'));
  assert.equal(acct.findValidReset(t1), undefined); assert.ok(acct.findValidReset(t2));
});

test('zh: forgot page and reset mail are localised', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'zh@example.com', password: 'zh password long', locale: 'zh-CN' }, '/signup');
  db.run("UPDATE users SET locale = 'zh-CN' WHERE email = 'zh@example.com'");
  const z = client(app); z.jar.set('lang', 'zh-CN');
  const r = await z.req('GET', '/forgot'); assert.match(r.body, /lang="zh-CN"/); assert.match(r.body, /[\u4e00-\u9fff]/);
  await z.post('/forgot', { email: 'zh@example.com' }, '/forgot');
  assert.match(sentMail.at(-1).subject, /[\u4e00-\u9fff]/);
});

test('data export contains own data and no secrets', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'exp@example.com', password: 'export password 1' }, '/signup');
  const tid = db.get("SELECT team_id FROM memberships WHERE user_id = ?", userId('exp@example.com')).team_id;
  db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, created_at) VALUES ('s_exp', ?, 'Mine', 'https://mine.example', 'tok', '2026-01-01')", tid);
  assert.match((await c.req('GET', '/app/settings')).body, /href="\/app\/account\/export"/);
  const r = await c.req('GET', '/app/account/export');
  assert.equal(r.statusCode, 200); assert.match(r.headers['content-disposition'], /attachment; filename="allyfolio-data-export-/);
  const j = JSON.parse(r.body);
  assert.equal(j.user.email, 'exp@example.com'); assert.equal(j.teams[0].sites[0].origin, 'https://mine.example');
  assert.doesNotMatch(r.body, /password_hash|scrypt|\$2[aby]\$|verify_token/);
  assert.match(String((await client(app).req('GET', '/app/account/export')).statusCode), /^30[23]$/, 'requires login');
});

test('deletion: wrong password rejected; ownership transfers; solo team deleted after Paddle cancel', async () => {
  const o = client(app), m = client(app);
  await o.post('/signup', { email: 'del@example.com', password: 'delete me please' }, '/signup');
  await m.post('/signup', { email: 'mate@example.com', password: 'mate password 1' }, '/signup');
  const oid = userId('del@example.com'), mid = userId('mate@example.com');
  const solo = db.get('SELECT team_id FROM memberships WHERE user_id = ?', oid).team_id;
  db.run("UPDATE teams SET plan='starter', billing_subscription_id='sub_solo', billing_customer_id='ctm_1', subscription_status='active' WHERE id = ?", solo);
  db.run("INSERT INTO sites (id, team_id, name, origin, verify_token, created_at) VALUES ('s_del', ?, 'D', 'https://d.example', 'tok', '2026-01-01')", solo);
  db.run("INSERT INTO teams (id, name, created_at) VALUES ('t_shared', 'Shared', '2026-01-01')");
  db.run("INSERT INTO memberships (team_id, user_id, role, created_at) VALUES ('t_shared', ?, 'owner', '2026-01-01'), ('t_shared', ?, 'member', '2026-01-02')", oid, mid);
  db.run("INSERT INTO waitlist (email, token, created_at) VALUES ('del@example.com', 'wtok', '2026-01-01')");
  let r = await o.post('/app/account/delete', { password: 'wrong wrong wrong' }, '/app/settings');
  assert.match(decodeURIComponent(r.headers.location as string), /did not match/i); assert.ok(userId('del@example.com'));
  r = await o.post('/app/account/delete', { password: 'delete me please' }, '/app/settings');
  assert.equal(r.statusCode, 200); assert.match(r.body, /deleted/i);
  assert.ok(r.cookies.some((c: any) => c.name === 'af_logged_in' && !c.value), 'hint cookie cleared');
  assert.ok(calls.some((c) => c.path === '/subscriptions/sub_solo/cancel' && c.body.effective_from === 'immediately'));
  assert.equal(userId('del@example.com'), undefined);
  assert.equal(db.get('SELECT COUNT(*) n FROM teams WHERE id = ?', solo).n, 0);
  assert.equal(db.get("SELECT COUNT(*) n FROM sites WHERE id = 's_del'").n, 0);
  assert.equal(db.get("SELECT role FROM memberships WHERE team_id = 't_shared' AND user_id = ?", mid).role, 'owner');
  assert.equal(db.get("SELECT COUNT(*) n FROM waitlist WHERE email = 'del@example.com'").n, 0);
  assert.equal(db.get('SELECT COUNT(*) n FROM sessions WHERE user_id = ?', oid).n, 0);
  assert.match(sentMail.at(-1).subject, /deleted/i);
  assert.match(String((await o.req('GET', '/app')).statusCode), /^30[23]$/);
});

test('deletion aborts if subscription cannot be canceled', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'keep@example.com', password: 'keep me around' }, '/signup');
  const id = userId('keep@example.com'); const tid = db.get('SELECT team_id FROM memberships WHERE user_id = ?', id).team_id;
  db.run("UPDATE teams SET plan='starter', billing_subscription_id='sub_fail', billing_customer_id='ctm_1', subscription_status='active' WHERE id = ?", tid);
  const r = await c.post('/app/account/delete', { password: 'keep me around' }, '/app/settings');
  assert.match(decodeURIComponent(r.headers.location as string), /could not|err/i);
  assert.ok(userId('keep@example.com')); assert.equal(db.get('SELECT COUNT(*) n FROM teams WHERE id = ?', tid).n, 1);
});
