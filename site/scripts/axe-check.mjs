// Runs axe-core (WCAG 2.0/2.1/2.2 A+AA rules) on every built page against `npm run preview`.
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { spawn } from 'node:child_process';

const base = process.env.BASE_URL ?? 'http://localhost:4321';
const pages = ['/', '/pricing', '/free-scan', '/blog', '/blog/what-the-eaa-means-for-smes', '/about', '/privacy', '/imprint', '/accessibility-statement'];
let server;
if (!process.env.BASE_URL) {
  server = spawn('npx', ['astro', 'preview', '--port', '4321'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
}
const browser = await chromium.launch();
let bad = 0;
for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 740 }]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  for (const p of pages) {
    const res = await page.goto(base + p);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    const sc = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    bad += sc.length;
    console.log(`${vp.width}px ${p} [HTTP ${res.status()}] violations=${r.violations.length} serious/critical=${sc.length} passes=${r.passes.length}`);
    for (const v of r.violations) console.log(`   - ${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  }
  await ctx.close();
}
await browser.close();
server?.kill();
process.exit(bad ? 1 : 0);
