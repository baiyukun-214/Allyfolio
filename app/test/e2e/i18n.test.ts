import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fixtureServer, client } from './helpers.ts';
let app: any, fx: any, db: any, sentMail: any[], workOnce: any, closeBrowser: any;
const state = { token: '' };
const bad = readFileSync(new URL('../fixtures/bad-page.html', import.meta.url), 'utf8');
before(async () => {
  fx = await fixtureServer({
    '/': (_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<!doctype html><html lang="en"><head><title>t</title><meta name="allyfolio-verification" content="${state.token}"></head><body><main><h1>Shop</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><form><input type="text"></form></main></body></html>`); },
    '/bad': bad,
  });
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
  ({ sentMail } = await import('../../src/lib/mailer.ts'));
  ({ workOnce } = await import('../../src/jobs/worker.ts'));
  ({ closeBrowser } = await import('../../src/lib/scanner.ts'));
});
after(async () => { await closeBrowser(); await app.close(); fx.server.close(); });

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });

test('locale resolution: Accept-Language < cookie < ?lang (persisted) and switcher', async () => {
  let r = await get('/login', { 'accept-language': 'zh-CN,zh;q=0.9' });
  assert.match(r.body, /<html lang="zh-CN">/); assert.match(r.body, /登录/);
  r = await get('/login', { 'accept-language': 'zh-CN', cookie: 'af_lang=en' });
  assert.match(r.body, /<html lang="en">/);
  r = await get('/login?lang=zh-CN', { cookie: 'af_lang=en' });
  assert.match(r.body, /<html lang="zh-CN">/);
  assert.equal(r.cookies.find((c: any) => c.name === 'af_lang')?.value, 'zh-CN');
  assert.match(r.body, /href="\/lang\?to=en&amp;next=%2Flogin" hreflang="en" lang="en" aria-label="Switch to English"/);
  r = await get('/signup', { cookie: 'af_lang=zh-CN' });
  assert.match(r.body, /创建您的账户/);
  r = await get('/lang?to=zh-CN&next=//evil.example');
  assert.equal(r.headers.location, '/app'); // no open redirect
});

test('user setting beats cookie; dashboard, emails, statement and reports in Chinese', async () => {
  const c = client(app);
  c.jar.set('af_lang', 'zh-CN');
  let r = await c.post('/signup', { email: 'zh@example.com', password: 'correct horse battery' }, '/signup');
  assert.equal(r.statusCode, 303);
  r = await c.req('GET', '/app');
  assert.match(r.body, /<html lang="zh-CN">/); assert.match(r.body, /添加网站/);
  assert.equal(db.get('SELECT locale FROM users WHERE email = ?', 'zh@example.com').locale, 'zh-CN');
  // Settings: switch to English; cookie says zh-CN but the user setting wins.
  r = await c.post('/app/settings', { locale: 'en' }, '/app/settings');
  assert.equal(r.statusCode, 303);
  c.jar.set('af_lang', 'zh-CN');
  r = await c.req('GET', '/app'); assert.match(r.body, /<html lang="en">/);
  r = await c.post('/app/settings', { locale: 'zh-CN' }, '/app/settings');
  r = await c.req('GET', '/app/settings'); assert.match(r.body, /<option value="zh-CN" lang="zh-CN" selected>/);

  // Site, verify, limit error in Chinese
  r = await c.post('/app/sites', { name: '店铺', origin: fx.base });
  const sitePath = r.headers.location as string;
  state.token = (await c.req('GET', sitePath)).body.match(/content="([0-9a-f]{32})"/)![1];
  r = await c.post(sitePath + '/verify', {}, sitePath);
  assert.match(decodeURIComponent(r.headers.location as string), /已验证/);
  r = await c.post('/app/sites', { name: 'b', origin: 'https://second.example.com' });
  assert.match(decodeURIComponent(r.headers.location as string), /未选方案|入门版/);

  db.run("UPDATE teams SET plan = 'business'");
  r = await c.post(sitePath + '/scan', {}, sitePath);
  assert.match(decodeURIComponent(r.headers.location as string), /[\u4e00-\u9fff]/);
  while (await workOnce({})) {}
  const scan = db.get("SELECT id FROM scans WHERE status = 'done' ORDER BY created_at DESC LIMIT 1");
  assert.ok(scan, 'scan finished');
  r = await c.req('GET', `/app/scans/${scan.id}`);
  assert.match(r.body, /图像必须有替代文本/); assert.match(r.body, /严重|较严重/); assert.match(r.body, /57%/); assert.match(r.body, /人工审查/);
  r = await c.req('GET', `/app/scans/${scan.id}/report`);
  assert.match(r.body, /<html lang="zh-CN">/); assert.match(r.body, /按规则列出的问题|证据/);
  r = await c.req('GET', `/app/scans/${scan.id}/report.pdf`);
  assert.equal(r.headers['content-type'], 'application/pdf');
  writeFileSync('/tmp/zh-report.pdf', r.rawPayload);
  const txt = execFileSync('pdftotext', ['/tmp/zh-report.pdf', '-']).toString();
  assert.match(txt, /图像必须有替代文本/); assert.match(txt, /57%/);
  r = await c.req('GET', sitePath.replace('/app/sites/', '/app/sites/') + '/statement');
  assert.match(r.body, /无障碍声明/); assert.match(r.body, /57%/);
  assert.doesNotMatch(r.body, /合规认证|保证合规|已认证|compliant|certified/i);
});

test('free scan API returns Chinese labels and help text; errors in Chinese', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: fx.base + '/bad', lang: 'zh-CN' } });
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  assert.equal(j.lang, 'zh-CN'); assert.match(j.note, /57%.*人工审查/s);
  const g = j.byImpact.find((x: any) => x.impact === 'critical') ?? j.byImpact[0];
  assert.ok(['严重', '较严重', '中等', '轻微'].includes(g.label));
  const img = j.byImpact.flatMap((x: any) => x.rules).find((x: any) => x.ruleId === 'image-alt');
  assert.equal(img.help, '图像必须有替代文本');
  r = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: 'ftp://x.example', lang: 'zh-CN' } });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /[\u4e00-\u9fff]/);
  r = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: 'ftp://x.example' } });
  assert.doesNotMatch(r.json().error, /[\u4e00-\u9fff]/);
});

test('waitlist in Chinese: message, email, non-JS redirect and confirmation page', async () => {
  let r = await app.inject({ method: 'POST', url: '/api/waitlist', payload: { email: 'nope', lang: 'zh-CN' } });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /有效/);
  r = await app.inject({ method: 'POST', url: '/api/waitlist', payload: { email: 'wl-zh@example.com', lang: 'zh-CN' } });
  assert.equal(r.statusCode, 200); assert.match(r.json().message, /[\u4e00-\u9fff]/);
  const mail = sentMail.filter((m) => m.to === 'wl-zh@example.com').at(-1);
  assert.match(mail.subject, /[\u4e00-\u9fff]/); assert.match(mail.text, /7 折|30%/);
  const token = mail.text.match(/token=([\w-]+)/)[1];
  r = await get(`/api/waitlist/confirm?token=${token}`);
  assert.match(r.body, /<html lang="zh-CN">/); assert.match(r.body, /候补/);
  r = await app.inject({ method: 'POST', url: '/api/waitlist', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'email=form-zh%40example.com&lang=zh-CN' });
  assert.equal(r.statusCode, 303); assert.match(r.headers.location, /\/zh\/waitlist-check-email$/);
});

test('links back to the marketing site (locale-aware) and the logged-in hint cookie', async () => {
  let r = await get('/login?lang=zh-CN');
  assert.match(r.body, /<a href="http:\/\/localhost:4321\/zh">← 返回官网<\/a>/);
  assert.match(r.body, /class="brand" href="http:\/\/localhost:4321\/zh"/);
  r = await get('/signup?lang=en');
  assert.match(r.body, /<a href="http:\/\/localhost:4321\/">← Back to website<\/a>/);
  const c = client(app);
  r = await c.post('/signup', { email: 'hint@example.com', password: 'correct horse battery' }, '/signup');
  const hint = r.cookies.find((x: any) => x.name === 'af_logged_in');
  assert.equal(hint?.value, '1'); assert.ok(!hint.httpOnly, 'hint must be readable by the marketing site');
  r = await c.req('GET', '/app');
  for (const h of ['http://localhost:4321/"', 'http://localhost:4321/blog"', 'http://localhost:4321/pricing"']) assert.ok(r.body.includes(`href="${h}`), h);
  assert.match(r.body, />Website</); assert.match(r.body, />Blog</); assert.match(r.body, />Pricing</);
  c.jar.set('af_lang', 'zh-CN'); await c.post('/app/settings', { locale: 'zh-CN' }, '/app/settings');
  r = await c.req('GET', '/app');
  assert.match(r.body, /href="http:\/\/localhost:4321\/zh\/blog">博客/); assert.match(r.body, />官网</); assert.match(r.body, />价格</);
  r = await c.req('POST', '/logout');
  assert.ok(r.cookies.some((x: any) => x.name === 'af_logged_in' && !x.value), 'hint cleared on logout');
});
