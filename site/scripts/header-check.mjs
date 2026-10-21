// Playwright check of the hide-on-scroll header against `astro preview` (en + zh, desktop + mobile, reduced motion).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const base = process.env.BASE_URL ?? 'http://localhost:4322';
let server;
if (!process.env.BASE_URL) {
  server = spawn('npx', ['astro', 'preview', '--port', '4322'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
}
const browser = await chromium.launch(); let n = 0;
const hidden = (p) => p.evaluate(() => document.getElementById('site-header').classList.contains('is-hidden'));
const top = (p) => p.evaluate(() => Math.round(document.getElementById('site-header').getBoundingClientRect().top));
const scrollBy = async (p, dy) => { await p.mouse.wheel(0, dy); await p.waitForTimeout(80); };
try {
  for (const path of ['/', '/zh']) for (const [vp, rm] of [[{ width: 1280, height: 800 }, 'no-preference'], [{ width: 375, height: 740 }, 'no-preference'], [{ width: 1280, height: 800 }, 'reduce']]) {
    const p = await (await browser.newContext({ viewport: vp, reducedMotion: rm })).newPage(); const tag = `${path} ${vp.width}px ${rm}`;
    await p.goto(base + path); await p.mouse.move(vp.width / 2, vp.height / 2);
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('site-header')).position), 'sticky', tag + ' sticky');
    await scrollBy(p, 300); await scrollBy(p, 300); assert.equal(await hidden(p), true, tag + ' scroll down hides');
    await p.waitForTimeout(350); assert.equal(await hidden(p), false, tag + ' idle shows');
    await scrollBy(p, 400); assert.equal(await hidden(p), true, tag + ' hidden again');
    await scrollBy(p, -150); assert.equal(await hidden(p), false, tag + ' scroll up shows');
    await p.waitForTimeout(400); assert.ok(Math.abs(await top(p)) <= 1, tag + ' visible at top of viewport after transition');
    const dur = parseFloat(await p.evaluate(() => getComputedStyle(document.getElementById('site-header')).transitionDuration));
    if (rm === 'reduce') assert.ok(dur < 0.001, tag + ' no animation'); else assert.ok(dur >= 0.2, tag + ' slide transition');
    // focus inside header keeps it visible
    await scrollBy(p, 400); assert.equal(await hidden(p), true, tag + ' hidden before focus');
    await p.evaluate(() => document.querySelector('#site-header a').focus()); assert.equal(await hidden(p), false, tag + ' focusin shows');
    await scrollBy(p, 400); await scrollBy(p, 400); assert.equal(await hidden(p), false, tag + ' stays while focused');
    // real Tab from page content into the header
    await p.evaluate(() => { document.activeElement.blur(); scrollTo(0, 2000); }); await p.waitForTimeout(100); await scrollBy(p, 300); assert.equal(await hidden(p), true, tag + ' hidden before Tab');
    await p.evaluate(() => { const m = document.getElementById('main'); m.focus(); }); await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift');
    assert.equal(await p.evaluate(() => document.getElementById('site-header').contains(document.activeElement)), true, tag + ' Shift+Tab lands in header');
    assert.equal(await hidden(p), false, tag + ' Tab into header shows');
    // near the top: always shown
    await p.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); }); await p.waitForTimeout(100); await scrollBy(p, 40); assert.equal(await hidden(p), false, tag + ' near top shown');
    // mobile menu open: never hidden
    if (vp.width < 1024) {
      await p.click('#nav-toggle'); await p.evaluate(() => document.activeElement.blur());
      await scrollBy(p, 400); await scrollBy(p, 400); assert.equal(await hidden(p), false, tag + ' menu open stays');
      await p.click('#nav-toggle');
    }
    // no JS: always visible sticky
    console.log('ok', tag); n++; await p.context().close();
  }
  const nj = await (await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } })).newPage();
  await nj.goto(base + '/'); await nj.evaluate(() => scrollTo(0, 1500)).catch(() => {}); await nj.mouse.wheel(0, 1500); await nj.waitForTimeout(200);
  assert.ok(Math.abs(await top(nj)) <= 1, 'no-JS header stays visible at top'); console.log('ok no-JS'); n++;
  console.log(`OK: ${n} header scenarios`);
} catch (e) { console.error('FAIL:', e.message); process.exitCode = 1; }
finally { await browser.close(); if (server) process.kill(-server.pid); }
