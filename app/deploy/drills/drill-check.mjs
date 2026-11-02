// Runs INSIDE the drill app container (node 22). Phase via env PHASE. Never prints tokens, secrets or full emails.
import { DatabaseSync } from 'node:sqlite';
const B = 'http://127.0.0.1:8787';
const jar = new Map();
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function req(method, path, form) {
  const r = await fetch(B + path, { method, redirect: 'manual', headers: { cookie: cookie(), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form).toString() : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
  return { status: r.status, location: r.headers.get('location'), body: await r.text() };
}
const csrf = async (p) => ((await req('GET', p)).body.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';
const redact = (e) => e.replace(/^(.).*?(@.).*$/, '$1***$2***');
const out = (k, v) => console.log(`[drill] ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
const phase = process.env.PHASE;
if (phase === 'counts') {
  const db = new DatabaseSync('/data/allyfolio.db', { readOnly: true });
  const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  out('integrity', db.prepare('PRAGMA integrity_check').get());
  out('rows', Object.fromEntries(['users', 'teams', 'memberships', 'sites', 'scans', 'scan_issues', 'sessions', 'billing_events', 'waitlist'].map((t) => [t, n(t)])));
  const u = db.prepare('SELECT email, (password_hash IS NOT NULL) AS haspw FROM users ORDER BY created_at LIMIT 1').get();
  if (u) { out('existing user', `${redact(u.email)} haspw=${u.haspw}`); console.log('DRILL_EMAIL=' + u.email); }
}
if (phase === 'link') {
  const t = await csrf('/login');
  const r = await req('POST', '/login/link', { email: process.env.DRILL_EMAIL, _csrf: t });
  out('POST /login/link', r.status);
}
if (phase === 'callback') {
  const r = await req('GET', '/login/callback?token=' + encodeURIComponent(process.env.DRILL_TOKEN));
  out('GET /login/callback', `${r.status} -> ${r.location} session=${jar.has('af_session')}`);
  const a = await req('GET', '/app');
  out('GET /app as existing user', `${a.status} dashboard=${/Log out|退出登录/.test(a.body)}`);
}
if (phase === 'signup') {
  const email = `restore-drill-${Date.now()}@example.invalid`, pw = 'drill-' + Math.random().toString(36).slice(2) + 'X9';
  let r = await req('POST', '/signup', { email, password: pw, _csrf: await csrf('/signup') });
  out('POST /signup temp user', `${r.status} -> ${r.location}`);
  r = await req('POST', '/logout', {}); out('POST /logout', r.status); jar.clear();
  r = await req('POST', '/login', { email, password: pw, _csrf: await csrf('/login') });
  out('POST /login (password) temp user', `${r.status} -> ${r.location}`);
  const a = await req('GET', '/app'); out('GET /app as temp user', `${a.status} dashboard=${/Log out|退出登录/.test(a.body)}`);
}
if (phase === 'scan') {
  const t0 = Date.now();
  const r = await fetch(B + '/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: process.env.SCAN_URL || 'https://example.com', rescan: true }) });
  const j = await r.json().catch(() => ({}));
  out('POST /api/scan', `${r.status} in ${Date.now() - t0}ms total=${j.total} code=${j.code ?? ''} error=${j.error ?? ''}`);
}
