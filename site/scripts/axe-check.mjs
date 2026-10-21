// Runs axe-core (WCAG 2.0/2.1/2.2 A+AA rules) on every built page against `npm run preview`.
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { spawn } from 'node:child_process';

const base = process.env.BASE_URL ?? 'http://localhost:4321';
const en = ['/', '/pricing', '/free-scan', '/blog', '/blog/what-the-eaa-means-for-smes', '/about', '/privacy', '/terms', '/dpa', '/imprint', '/accessibility-statement', '/waitlist-check-email', '/waitlist-error',
  '/features', '/resources', '/eaa', '/bfsg', '/microenterprise-exemption', '/who-is-affected', '/en-301-549-wcag',
  '/blog/why-accessibility-overlays-dont-work', '/blog/what-automated-accessibility-testing-cant-catch'];
const zh = en.map((p) => (p === '/' ? '/zh' : '/zh' + p));
const pages = process.env.PAGES ? process.env.PAGES.split(',') : [...en, ...zh];
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
let server;
if (!process.env.BASE_URL) {
  server = spawn('npx', ['astro', 'preview', '--port', '4321'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
}
const browser = await chromium.launch();
let bad = 0, total = 0;
for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 740 }]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  for (const p of pages) {
    const res = await page.goto(base + p);
    // Let one-time entrance motion (reveals, hero scan illustration) settle so axe checks the resting state.
    await page.waitForTimeout(p === '/' || p === '/zh' ? 5000 : 900);
    const r = await new AxeBuilder({ page }).withTags(tags).analyze();
    const sc = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    bad += sc.length; total += r.violations.length;
    const want = p.startsWith('/zh') ? 'zh-CN' : 'en'; const lang = await page.getAttribute('html', 'lang');
    if (lang !== want || res.status() !== 200) { console.log(`   ! lang=${lang} (want ${want}) status=${res.status()}`); bad++; }
    if (vp.width < 1024 && (p === '/' || p === '/zh')) { // open mobile menu and check it too
      await page.click('#nav-toggle'); const m = await new AxeBuilder({ page }).withTags(tags).analyze();
      total += m.violations.length; bad += m.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).length;
      console.log(`${vp.width}px ${p} [menu open] violations=${m.violations.length}`); for (const v of m.violations) console.log(`   - ${v.impact} ${v.id}: ${v.help}`);
    }
    console.log(`${vp.width}px ${p} [HTTP ${res.status()}] violations=${r.violations.length} serious/critical=${sc.length} passes=${r.passes.length}`);
    for (const v of r.violations) console.log(`   - ${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  }
  await ctx.close();
}
await browser.close();
server?.kill();
console.log(bad ? `FAIL: ${bad} serious/critical or lang/status problems` : `OK: 0 serious/critical (${total} violations of any impact) on ${pages.length} pages x 2 widths`);
process.exit(bad ? 1 : 0);
