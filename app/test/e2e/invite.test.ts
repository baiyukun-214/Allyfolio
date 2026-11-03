import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import './helpers.ts';
process.env.PADDLE_DISCOUNT_CODE_ID = 'dsc_01h8earlybirdcode000000000'; process.env.PADDLE_DISCOUNT_CODE = 'EARLYBIRD30';
const { inviteMail } = await import('../../src/lib/invite.ts');
const BANNED = new RegExp(['compl' + 'iant', 'certi' + 'fied', 'guaran' + 'tee', 'kon' + 'form', 'zertifi' + 'ziert', 'garan' + 'tiert', '合' + '规', '认' + '证', 'coming' + ' soon'].join('|'), 'i');

test('invite mail: EN / DE / ZH, signup link with the waitlist site, early-bird line and fallback code', () => {
  const en = inviteMail({ email: 'a@x.example', locale: 'en', site: 'https://shop.example', early_bird: 1 });
  assert.equal(en.lang, 'en'); assert.match(en.subject, /Allyfolio invite/);
  assert.match(en.text, /http:\/\/localhost:8787\/signup\?lang=en&site=https%3A%2F%2Fshop\.example\n/);
  assert.match(en.text, /sign up with the same email \(a@x\.example\) to keep your 30% early-bird discount/i);
  assert.match(en.text, /enter the code EARLYBIRD30/);
  const de = inviteMail({ email: 'b@x.example', locale: 'de', site: null, early_bird: 1 });
  assert.equal(de.lang, 'de'); assert.match(de.subject, /Einladung/); assert.match(de.text, /\/signup\?lang=en\n/, 'German readers: English app, no site param');
  assert.match(de.text, /derselben E-Mail-Adresse \(b@x\.example\).*30 % Frühbucher-Rabatt/); assert.match(de.text, /Code EARLYBIRD30/);
  const zh = inviteMail({ email: 'c@x.example', locale: 'zh-CN', site: 'https://zh.example/path', early_bird: 0 });
  assert.equal(zh.lang, 'zh-CN'); assert.match(zh.text, /\/signup\?lang=zh-CN&site=https%3A%2F%2Fzh\.example\n/);
  assert.doesNotMatch(zh.text, /早鸟|EARLYBIRD30/, 'no early-bird text for members after the first 100');
  for (const m of [en, de, zh]) { assert.doesNotMatch(m.subject + m.text, BANNED); assert.match(m.text, /€19|19 €/); }
  // Chinese is internal-only: customer-facing invites state English now, German interface in development, and never promise a date.
  assert.match(en.text, /app interface is currently in English; a German interface is in development/);
  assert.match(de.text, /Oberfläche der App ist derzeit auf Englisch; eine deutsche Oberfläche ist in Entwicklung/);
  for (const m of [en, de]) assert.doesNotMatch(m.text, /Chines|chinesisch|中文|demn(ä|a)chst|bald verfügbar/i);
});

test('invite script: dry run by default, skips unconfirmed / signed-up / invited, console send marks nobody', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inv-')); const dbPath = join(dir, 'a.db');
  const env = { ...process.env, DATABASE_PATH: dbPath, MAILER: 'console', RESEND_API_KEY: '', LOG_LEVEL: 'warn' };
  const run = (...a: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/waitlist-invite.ts', ...a], { env, encoding: 'utf8' });
  let r = run(); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /DRY RUN – nothing is sent: 0 recipient/);
  const db = new DatabaseSync(dbPath);
  const ins = db.prepare('INSERT INTO waitlist (email, token, created_at, confirmed_at, early_bird, locale, site, invited_at) VALUES (?,?,?,?,?,?,?,?)');
  ins.run('en@x.example', 't1', '2026-01-01', '2026-01-02', 1, 'en', 'https://en.example', null);
  ins.run('de@x.example', 't2', '2026-01-01', '2026-01-03', 1, 'de', null, null);
  ins.run('zh@x.example', 't3', '2026-01-01', '2026-01-04', 0, 'zh-CN', null, null);
  ins.run('unconfirmed@x.example', 't4', '2026-01-01', null, 0, 'en', null, null);
  ins.run('done@x.example', 't5', '2026-01-01', '2026-01-02', 1, 'en', null, '2026-02-01');
  ins.run('user@x.example', 't6', '2026-01-01', '2026-01-02', 1, 'en', null, null);
  db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'user@x.example', '2026-01-01')").run();
  r = run(); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN – nothing is sent: 3 recipient\(s\) \(en 1, de 1, zh-CN 1; early bird 2\)/);
  assert.doesNotMatch(r.stdout, /unconfirmed@|done@|user@|\[mail\]/);
  assert.match(r.stdout, /preview \(de\)[\s\S]*Ihre Einladung/); assert.match(r.stdout, /Nothing was sent/);
  r = run('--to', 'DE@x.example'); assert.match(r.stdout, /1 recipient/);
  r = run('--resend'); assert.match(r.stdout, /4 recipient/);
  r = run('--bogus'); assert.equal(r.status, 1);
  r = run('--send', '--to', 'en@x.example'); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /\[mail\] to=en@x\.example/); assert.match(r.stdout, /1 sent, 0 failed \(MAILER=console: logged only, nobody marked as invited\)/);
  assert.equal((db.prepare("SELECT invited_at FROM waitlist WHERE email = 'en@x.example'").get() as any).invited_at, null);
});
