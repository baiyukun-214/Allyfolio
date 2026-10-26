import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { t } from '../../src/i18n.ts';
// Config is read at import time, so evaluate it in a child process with a controlled environment.
const evalWith = (env: Record<string, string>, code: string) => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code],
  { env: { PATH: process.env.PATH ?? '', NODE_TEST_CONTEXT: 'child', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const cfg = "const { config } = await import('./src/config.ts');";

test('PADDLE_ENV: sandbox by default, live (and production) select the live API', () => {
  assert.equal(evalWith({}, `${cfg} console.log(config.billing.paddle.env)`), 'sandbox');
  assert.equal(evalWith({ PADDLE_ENV: 'live' }, `${cfg} console.log(config.billing.paddle.env)`), 'production');
  assert.equal(evalWith({ PADDLE_ENV: 'production' }, `${cfg} console.log(config.billing.paddle.env)`), 'production');
  assert.equal(evalWith({ PADDLE_ENV: 'bogus' }, `${cfg} console.log(config.billing.paddle.env)`), 'sandbox');
});
test('Paddle price IDs come from env vars', () => {
  const out = evalWith({ PADDLE_PRICE_STARTER: 'pri_a', PADDLE_PRICE_BUSINESS: 'pri_b', PADDLE_PRICE_AGENCY: 'pri_c', PADDLE_PRICE_ONEOFF: 'pri_d' }, `${cfg} console.log(Object.values(config.billing.paddle.prices).join(','))`);
  assert.equal(out, 'pri_a,pri_b,pri_c,pri_d');
});
test('SITE_ORIGINS is a comma-separated list', () => {
  assert.equal(evalWith({ SITE_ORIGINS: 'https://allyfolio.com, https://www.allyfolio.com' }, `${cfg} console.log(JSON.stringify(config.siteOrigins))`), '["https://allyfolio.com","https://www.allyfolio.com"]');
});
test('mailer falls back to console logging when RESEND_API_KEY is missing', () => {
  const code = "const { mailer, ConsoleMailer, ResendMailer } = await import('./src/lib/mailer.ts'); console.log(mailer.constructor.name)";
  assert.equal(evalWith({ MAILER: 'resend' }, code).split('\n').pop(), 'ConsoleMailer');
  assert.equal(evalWith({}, code), 'ConsoleMailer');
  assert.equal(evalWith({ RESEND_API_KEY: 're_placeholder_for_test' }, code), 'ResendMailer');
});
test('score label is "Automated checks score" / 自动化检测得分 in UI copy', () => {
  assert.equal(t('en').mon.score, 'Automated checks score');
  assert.equal(t('zh-CN').mon.score, '自动化检测得分');
  assert.match(t('en').mon.scoreAria(80), /^Automated checks score/);
  assert.match(t('zh-CN').mon.scoreAria(80), /^自动化检测得分/);
});
test('deploy files: env example has placeholders only and PUBLIC_APP_LIVE is never true', () => {
  const ex = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  for (const k of ['SITE_ORIGINS', 'RESEND_API_KEY', 'PADDLE_ENV', 'PADDLE_WEBHOOK_SECRET', 'PADDLE_PRICE_STARTER', 'PADDLE_PRICE_BUSINESS', 'PADDLE_PRICE_AGENCY', 'PADDLE_PRICE_ONEOFF', 'SESSION_SECRET'])
    assert.match(ex, new RegExp(`^${k}=`, 'm'), k);
  assert.doesNotMatch(ex, /re_[A-Za-z0-9]{20,}|pdl_(live|sdbx)_apikey_[A-Za-z0-9]{10,}|ntfset_[A-Za-z0-9]{10,}/);
  for (const f of ['../../docker-compose.yml', '../../Dockerfile', '../../deploy/Caddyfile', '../../DEPLOY.md', '../../.env.example'])
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /PUBLIC_APP_LIVE\s*=\s*["']?true/);
  assert.match(readFileSync(new URL('../../deploy/Caddyfile', import.meta.url), 'utf8'), /^app\.allyfolio\.com \{/m);
});
