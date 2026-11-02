import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_SELECTORS, CONSENT_TEXTS } from '../../src/lib/consent.ts';

test('consent: known CMP accept selectors are covered', () => {
  for (const s of ['#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept',
    '#didomi-notice-agree-button', '[data-testid="uc-accept-all-button"]', '#truste-consent-button']) assert.ok(CONSENT_SELECTORS.includes(s), s);
  assert.ok(CONSENT_SELECTORS.some((s) => s.includes('qc-cmp2')), 'Quantcast');
});
test('consent: EN/DE accept texts, "accept all" variants before bare "accept", all lower-case', () => {
  for (const t of ['accept all', 'accept', 'agree', 'allow all', 'alle akzeptieren', 'akzeptieren', 'zustimmen', 'einverstanden']) assert.ok(CONSENT_TEXTS.includes(t), t);
  assert.ok(CONSENT_TEXTS.indexOf('accept all') < CONSENT_TEXTS.indexOf('accept'));
  assert.ok(CONSENT_TEXTS.indexOf('alle akzeptieren') < CONSENT_TEXTS.indexOf('akzeptieren'));
  for (const t of CONSENT_TEXTS) assert.equal(t, t.toLowerCase().trim());
  assert.ok(!CONSENT_TEXTS.some((t) => /reject|ablehnen|settings|einstellungen|notwendig/.test(t)), 'never a reject/settings button');
});
