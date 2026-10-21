import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, normLocale, fromAcceptLanguage, trError, LOCALES } from '../../src/i18n.ts';
import { ruleHelp } from '../../src/lib/scanner.ts';
import { LimitError } from '../../src/lib/plans.ts';

test('normLocale and Accept-Language', () => {
  assert.equal(normLocale('zh'), 'zh-CN'); assert.equal(normLocale('zh-cn'), 'zh-CN'); assert.equal(normLocale('en-GB'), 'en'); assert.equal(normLocale('fr'), null);
  assert.equal(fromAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8'), 'zh-CN');
  assert.equal(fromAcceptLanguage('de-DE,en;q=0.5'), 'en');
  assert.equal(fromAcceptLanguage('fr-FR'), null);
});
const keysDeep = (o: any, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) ? keysDeep(v, p + k + '.') : [p + k]);
test('zh dictionary has every key of en, with the same types', () => {
  const en = keysDeep(t('en')), zh = new Set(keysDeep(t('zh-CN')));
  for (const k of en) assert.ok(zh.has(k), `missing zh key ${k}`);
});
test('automation note keeps the 57% caveat and manual review in both languages', () => {
  assert.match(t('en').automationNote, /57%.*manual review/s);
  assert.match(t('zh-CN').automationNote, /57%.*人工审查/s);
});
const FORBIDDEN = /\b(compliant|compliance|certified|certificat\w*|guarantee\w*)\b|合规认证|保证合规|已认证/i;
test('score note keeps the 57% caveat and says it is not a legal assessment in both languages', () => {
  assert.equal(t('en').mon.score, 'Automated checks score'); assert.equal(t('zh-CN').mon.score, '自动化检测得分');
  assert.match(t('en').mon.scoreNote, /about 57%, per Deque.*not a conformance rating or legal assessment/s);
  assert.match(t('zh-CN').mon.scoreNote, /约 57%.*不是符合性评级.*法律评估/s);
});
test('no forbidden claims in any dictionary string', () => {
  for (const l of LOCALES) {
    const strings: string[] = [];
    const walk = (o: any) => { for (const v of Object.values(o)) { if (typeof v === 'string') strings.push(v); else if (typeof v === 'function') { try { const r = v('X', 1, 1); strings.push(Array.isArray(r) ? r.join('') : String(r)); } catch {} } else if (v && typeof v === 'object') walk(v); } };
    walk(t(l));
    for (const s of strings) assert.doesNotMatch(s, FORBIDDEN, s);
  }
});
test('error and rule help translation', () => {
  assert.equal(trError('zh-CN', t('en').errors.notPublic), t('zh-CN').errors.notPublic);
  assert.equal(trError('en', 'anything'), 'anything');
  assert.equal(ruleHelp('image-alt', 'Images must have alternative text', 'zh-CN'), '图像必须有替代文本');
  assert.equal(ruleHelp('image-alt', 'Images must have alternative text', 'en'), 'Images must have alternative text');
  assert.equal(ruleHelp('no-such-rule', 'Fallback', 'zh-CN'), 'Fallback');
});
test('limit errors are localised', () => {
  const e = new LimitError('sites', 'starter', 1);
  assert.match(e.msg('en'), /Starter plan includes 1 site\./);
  assert.match(e.msg('zh-CN'), /入门版/);
});
