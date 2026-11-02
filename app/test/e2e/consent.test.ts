import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { fixtureServer } from './helpers.ts';

const dir = new URL('../fixtures/consent/', import.meta.url);
const routes: Record<string, string> = {};
for (const f of readdirSync(dir)) routes[`/consent/${f}`] = readFileSync(new URL(f, dir), 'utf8');
let srv: Awaited<ReturnType<typeof fixtureServer>>, browser: Browser, app: any, dismissConsent: any, closeBrowser: any;
before(async () => {
  srv = await fixtureServer(routes);
  browser = await chromium.launch();
  ({ dismissConsent } = await import('../../src/lib/consent.ts'));
  ({ closeBrowser } = await import('../../src/lib/scanner.ts'));
  app = await (await import('../../src/server.ts')).buildServer();
});
after(async () => { await browser.close(); await closeBrowser(); await app.close(); srv.server.close(); });

async function open(name: string) {
  const page = await browser.newPage();
  await page.goto(`${srv.base}/consent/${name}.html`, { waitUntil: 'load' });
  return page;
}
const state = (page: any) => page.evaluate(() => ({ consent: (window as any).__consent ?? null, banner: !!document.getElementById('banner') || !!document.getElementById('usercentrics-root'), path: location.pathname }));

for (const [name, expect, clickedRe] of [
  ['onetrust', 'onetrust', /onetrust-accept-btn-handler/],
  ['cookiebot', 'cookiebot', /CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll/],
  ['german', 'de', /text:alle akzeptieren/],
  ['shadow', 'uc', /uc-accept-all-button/],
  ['iframe', 'iframe', /truste-consent-button/],
] as const) {
  test(`consent: ${name} banner is accepted and removed`, async () => {
    const page = await open(name);
    const r = await dismissConsent(page);
    assert.match(String(r.clicked), clickedRe, JSON.stringify(r));
    assert.equal(r.timedOut, false); assert.ok(r.ms < 2000, `took ${r.ms}ms`);
    const s = await state(page);
    assert.equal(s.consent, expect); assert.equal(s.banner, false); assert.equal(s.path, `/consent/${name}.html`, 'no navigation');
    await page.close();
  });
}
test('consent: no banner → nothing clicked; navigating "Accept" links and other buttons are left alone', async () => {
  const page = await open('none');
  const r = await dismissConsent(page);
  assert.equal(r.clicked, null); assert.equal(r.timedOut, false); assert.ok(r.ms < 500, `took ${r.ms}ms`);
  const s = await state(page); assert.equal(s.path, '/consent/none.html');
  assert.equal(await page.evaluate(() => (window as any).__clicked ?? 0), 0);
  await page.close();
});
test('consent: a no-op accept button is clicked once and returns quickly', async () => {
  const page = await open('noop');
  const r = await dismissConsent(page);
  assert.equal(r.clicked, 'text:accept'); assert.ok(r.ms < 2000, `took ${r.ms}ms`);
  assert.equal((await state(page)).consent, 'noop');
  await page.close();
});
test('consent: a hung page (busy main thread) is abandoned at the 2 s cap', async () => {
  const page = await open('slow');
  await page.waitForTimeout(100); // busy loop has started
  const t0 = Date.now();
  const r = await dismissConsent(page);
  const ms = Date.now() - t0;
  assert.equal(r.timedOut, true); assert.equal(r.clicked, null);
  assert.ok(ms >= 1900 && ms < 2300, `took ${ms}ms`);
  await page.close();
});
test('consent: a banner that appears late is not waited for', async () => {
  const page = await open('late');
  const r = await dismissConsent(page);
  assert.equal(r.clicked, null); assert.ok(r.ms < 500, `took ${r.ms}ms`);
  await page.close();
});
test('consent: never throws on a closed page', async () => {
  const page = await open('none'); await page.close();
  const r = await dismissConsent(page);
  assert.equal(r.clicked, null);
});
test('scan: banner issues are gone after auto-accept (OneTrust), still reported when no known accept control exists', async () => {
  const rules = async (name: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: `${srv.base}/consent/${name}.html`, rescan: true } });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().byImpact.flatMap((g: any) => g.rules.map((r: any) => r.ruleId)) as string[];
  };
  const { freeLimit } = await import('../../src/lib/freescan.ts');
  freeLimit.reset();
  assert.ok(!(await rules('onetrust')).includes('label'), 'unlabelled checkbox inside the dismissed banner must not be reported');
  assert.ok(!(await rules('cookiebot')).includes('label'));
  assert.ok((await rules('noop')).includes('label'), 'banner that stays is still scanned');
});
test('scan: a hung page still finishes (consent step capped, scan not failed by it)', async () => {
  const { freeLimit } = await import('../../src/lib/freescan.ts');
  freeLimit.reset();
  const t0 = Date.now();
  const res = await app.inject({ method: 'POST', url: '/api/scan', payload: { url: `${srv.base}/consent/late.html`, rescan: true } });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(Date.now() - t0 < 20000);
});
test('consent: text matching normalises whitespace/ticks but keeps words intact ("Accept all cookies")', async () => {
  const page = await browser.newPage();
  await page.setContent('<div id="banner"><button onclick="window.__consent=1;this.parentNode.remove()">\n  Accept   all cookies ✓ </button></div>');
  const r = await dismissConsent(page);
  assert.equal(r.clicked, 'text:accept all cookies');
  await page.close();
});
