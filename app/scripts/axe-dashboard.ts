// Runs axe-core (WCAG 2.0–2.2 A/AA + best practice) on every dashboard page, at desktop and mobile widths.
// Spins up the app with an in-memory DB and a local fixture site; exits non-zero on serious/critical violations.
import http from 'node:http';
process.env.ALLOW_PRIVATE_TARGETS = '1'; process.env.DATABASE_PATH = ':memory:'; process.env.WORKER = '0'; process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
const { chromium } = await import('playwright');
const { AxeBuilder } = await import('@axe-core/playwright');
const { buildServer } = await import('../src/server.ts');
const db = await import('../src/db.ts');
const { workOnce } = await import('../src/jobs/worker.ts');
const { closeBrowser } = await import('../src/lib/scanner.ts');
const shots = process.env.SHOTS_DIR;

let token = '';
const fx = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<html lang="en"><head><title>x</title><meta name="allyfolio-verification" content="${token}"></head><body><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><a href="/p2">p2</a></body></html>`); });
await new Promise<void>((r) => fx.listen(0, '127.0.0.1', r));
const fxBase = `http://127.0.0.1:${(fx.address() as any).port}`;
const app = await buildServer(); await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${(app.server.address() as any).port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const p = await ctx.newPage();
await p.goto(base + '/signup'); await p.fill('#email', 'axe@example.com'); await p.fill('#password', 'a long enough password'); await p.click('button[type=submit] >> text=Create account');
db.run("UPDATE teams SET plan = 'agency', brand_name = 'Pixel Agency'");
await p.goto(base + '/app'); await p.fill('#name', 'Fixture'); await p.fill('#origin', fxBase); await p.click('button:has-text("Add site")');
const siteUrl = p.url(); token = (await p.content()).match(/content="([0-9a-f]{32})"/)![1];
await Promise.all([p.waitForNavigation(), p.click('button:has-text("Check now")')]); console.log('verify:', await p.textContent('.alert').catch(() => 'none'), token); await workOnce({}); await workOnce({});
const scanId = db.get<any>("SELECT id FROM scans WHERE status='done' LIMIT 1")!.id;
const pages = ['/app', '/app/settings', siteUrl.replace(base, ''), `/app/scans/${scanId}`, `/app/scans/${scanId}/report`, `/app/team`, '/app/billing', `${siteUrl.replace(base, '')}/statement`];
let bad = 0, total = 0; let lang = 'en';
const langs = (process.env.LANGS ?? 'en,zh-CN').split(',');
const check = async (page: any, path: string, w: number) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  const sc = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact!)); bad += sc.length; total += r.violations.length;
  const htmlLang = await page.getAttribute('html', 'lang'); if (htmlLang !== lang) { console.log(`   ! html lang=${htmlLang}, expected ${lang}`); bad++; }
  console.log(`[${lang}] ${w}px ${path.replace(/[0-9a-f-]{36}/g, ':id')} violations=${r.violations.length} serious/critical=${sc.length}`);
  for (const v of r.violations) console.log(`   - ${v.impact} ${v.id}: ${v.help} ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  if (shots) await page.screenshot({ path: `${shots}/${path === '/app' ? 'app' : path.replace(/^\/app\//, '').replace(/[0-9a-f-]{36}/g, 'id').replace(/\//g, '_')}-${lang}-${w}.png`, fullPage: true });
};
for (const l of langs) {
  lang = l; db.run('UPDATE users SET locale = ?', l);
  for (const w of [1280, 375]) {
    await p.setViewportSize({ width: w, height: 800 });
    for (const path of pages) { await p.goto(base + path); await check(p, path, w); }
    const anon = await browser.newContext({ viewport: { width: w, height: 800 } }); const a = await anon.newPage();
    for (const path of ['/login', '/signup', '/forgot', '/reset?token=invalid']) { await a.goto(`${base}${path}?lang=${l}`); await check(a, path, w); }
    await anon.close();
  }
}
await browser.close(); await closeBrowser(); await app.close(); fx.close();
console.log(bad ? `FAIL: ${bad} serious/critical` : `OK: 0 serious/critical (${total} violations of any impact)`);
process.exit(bad ? 1 : 0);
