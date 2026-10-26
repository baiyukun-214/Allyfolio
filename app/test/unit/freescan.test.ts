import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
process.env.FREE_SCAN_PER_IP_PER_HOUR = '2';
const { freeLimit, etaSeconds, cacheKey, cachePut, cacheGet, cacheClear } = await import('../../src/lib/freescan.ts');
const { ruleInfo, wcagLink, RULE_INFO_IDS } = await import('../../src/lib/rule-info.ts');
const { t, scanError } = await import('../../src/i18n.ts');
const FORBIDDEN = /compliant|compliance|certif|guarantee|合规|认证|保证/i;

test('hourly limit counts successes and in-flight scans, not failures', () => {
  freeLimit.reset();
  const a = freeLimit.begin('1.2.3.4'); freeLimit.end(a, false);
  const b = freeLimit.begin('1.2.3.4'); freeLimit.end(b, false);
  assert.equal(freeLimit.check('1.2.3.4').ok, true, 'failures are free');
  freeLimit.end(freeLimit.begin('1.2.3.4'), true);
  const running = freeLimit.begin('1.2.3.4');
  const c = freeLimit.check('1.2.3.4'); assert.equal(c.ok, false); assert.ok(c.retryAfterS > 3000);
  freeLimit.end(running, false);
  assert.equal(freeLimit.check('1.2.3.4').ok, true);
  assert.equal(freeLimit.check('5.6.7.8').ok, true, 'per IP');
});
test('cache key ignores hash and host case; entries expire', () => {
  cacheClear();
  const k = cacheKey(new URL('https://Example.com/a#x'));
  assert.equal(k, 'https://example.com/a');
  cachePut([k], { id: 'x', url: k, scannedAt: '', at: Date.now(), issues: [] });
  assert.equal(cacheGet(k)?.id, 'x');
  cachePut([k], { id: 'y', url: k, scannedAt: '', at: Date.now() - 16 * 60_000, issues: [] });
  assert.equal(cacheGet(k), undefined);
});
test('ETA grows with the queue', () => {
  assert.ok(etaSeconds(4, 2, 2) > etaSeconds(0, 0, 2));
});
test('about 30 rules have EN/ZH explanations, generic fallback otherwise, no forbidden wording', () => {
  assert.ok(RULE_INFO_IDS.length >= 30, String(RULE_INFO_IDS.length));
  for (const id of RULE_INFO_IDS) for (const l of ['en', 'zh-CN']) {
    const i = ruleInfo(id, l); assert.ok(i.what && i.who && i.fix, id);
    assert.doesNotMatch(i.what + i.who + i.fix, FORBIDDEN, id);
    if (l === 'zh-CN') assert.match(i.what, /[\u4e00-\u9fff]/);
  }
  assert.equal(ruleInfo('some-new-rule', 'zh-CN').generic, true);
});
test('WCAG Understanding links', () => {
  assert.equal(wcagLink('WCAG 1.4.3 (AA)').url, 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum');
  assert.equal(wcagLink('WCAG 4.1.1 (A)').url, 'https://www.w3.org/WAI/WCAG21/Understanding/parsing');
  assert.equal(wcagLink('WCAG 9.9.9').url, 'https://www.w3.org/WAI/WCAG22/Understanding/');
});
test('busy message and score note wording', () => {
  for (const l of ['en', 'zh-CN'] as const) {
    const S = t(l);
    assert.doesNotMatch(S.scanErrors.busy(30) + S.mon.scoreNote, FORBIDDEN);
    assert.match(S.mon.scoreNote, /57%/);
  }
  assert.match(t('en').scanErrors.busy(30), /30 seconds/); assert.match(t('en').scanErrors.busy(120), /2 minutes/);
  assert.match(t('en').mon.scoreNote, /not a full accessibility audit or legal assessment/);
  assert.match(t('zh-CN').mon.scoreNote, /不是完整的无障碍审查或法律评估/);
  assert.equal(scanError('en', 'x').code, 'load_failed');
});
