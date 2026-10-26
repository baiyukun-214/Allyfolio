import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanError, t } from '../../src/i18n.ts';
import { classifyLoadError } from '../../src/lib/scanner.ts';
import { parsePublicUrl } from '../../src/lib/ssrf.ts';

const FORBIDDEN = /compliant|compliance|certif|guarantee|合规|认证|保证/i;

test('Chromium navigation errors map to specific codes', () => {
  const code = (m: string) => scanError('en', classifyLoadError(m)).code;
  assert.equal(code('page.goto: net::ERR_CONNECTION_REFUSED at https://x'), 'blocked');
  assert.equal(code('page.goto: net::ERR_CONNECTION_RESET at https://baidu.com'), 'blocked');
  assert.equal(code('page.goto: net::ERR_EMPTY_RESPONSE'), 'blocked');
  assert.equal(code('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED'), 'blocked');
  assert.equal(code('page.goto: Timeout 30000ms exceeded.'), 'timeout');
  assert.equal(code('page.goto: net::ERR_TIMED_OUT'), 'timeout');
  assert.equal(code('page.goto: net::ERR_NAME_NOT_RESOLVED'), 'dns_not_found');
  assert.equal(code('page.goto: net::ERR_CERT_AUTHORITY_INVALID'), 'load_failed');
  assert.equal(code('something odd'), 'load_failed');
});
test('SSRF/URL messages map to invalid_url, not_public and dns_not_found', () => {
  assert.equal(scanError('en', 'That does not look like a valid URL.').code, 'invalid_url');
  assert.equal(scanError('en', 'Please enter a URL.').code, 'invalid_url');
  assert.equal(scanError('en', 'Only standard ports (80 and 443) can be scanned.').code, 'invalid_url');
  assert.equal(scanError('en', 'That address is not publicly reachable.').code, 'not_public');
  assert.equal(scanError('en', 'We could not find that domain.').code, 'dns_not_found');
  assert.equal(scanError('en', undefined).code, 'load_failed');
});
test('missing scheme gets https:// added', () => {
  assert.equal(parsePublicUrl('example.com/page').href, 'https://example.com/page');
  assert.equal(parsePublicUrl('  www.example.com ').href, 'https://www.example.com/');
});
test('every message is localized, gives a next step and avoids compliance/certification wording', () => {
  for (const l of ['en', 'zh-CN'] as const) {
    for (const m of ['That does not look like a valid URL.', 'That address is not publicly reachable.', 'We could not find that domain.', 'The page took too long to load.', 'The site refused the connection.', 'We could not load that page.']) {
      const { error } = scanError(l, m);
      assert.ok(error.length > (l === 'en' ? 30 : 15), `${l} ${m}`);
      assert.doesNotMatch(error, FORBIDDEN);
      if (l === 'zh-CN') assert.match(error, /[\u4e00-\u9fff]/);
      assert.notEqual(error, l === 'en' ? 'We could not load that page.' : '无法加载该页面。');
    }
    const S = t(l).scanErrors;
    assert.doesNotMatch(S.rate_limited(5, 12) + S.rate_limited(5, null), FORBIDDEN);
    assert.match(S.rate_limited(5, 12), /12/);
  }
  assert.match(scanError('zh-CN', 'The site refused the connection.').error, /海外|数据中心/);
  assert.match(scanError('en', 'The site refused the connection.').error, /overseas|data-centre/);
});
test('empty MAILER does not crash and picks resend/console automatically', async () => {
  const { execFileSync } = await import('node:child_process');
  const run = (env: Record<string, string>) => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "const { mailer } = await import('./src/lib/mailer.ts'); console.log(mailer.constructor.name)"],
    { env: { PATH: process.env.PATH ?? '', NODE_TEST_CONTEXT: 'child', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(run({ MAILER: '' }), 'ConsoleMailer');
  assert.equal(run({ MAILER: ' ', RESEND_API_KEY: 're_placeholder_for_test' }), 'ResendMailer');
  assert.equal(run({ MAILER: 'console', RESEND_API_KEY: 're_placeholder_for_test' }), 'ConsoleMailer');
});
