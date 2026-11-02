import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureServer, client } from './helpers.ts';
let app: any, fx: any, db: any, sentMail: any[], workOnce: any, closeBrowser: any, sitemapUrls: any;
const state = { token: '', broken: false };
const pageHtml = (body: string) => `<!doctype html><html lang="en"><head><title>t</title><meta name="allyfolio-verification" content="${state.token}"></head><body><main><h1>Shop</h1>${body}</main></body></html>`;
before(async () => {
  fx = await fixtureServer({
    '/sitemap.xml': '', // filled below once base is known
    '/': (_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(pageHtml(`<a href="/about">About</a><a href="/hidden">Hidden</a><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`)); },
    '/about': (_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(pageHtml(state.broken ? '<form><input type="text"></form>' : '<p>About us</p>')); },
    '/hidden': (_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(pageHtml('<p>Only linked</p>')); },
    '/contact': (_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(pageHtml('<p>Contact</p>')); },
  });
  const sm = `<?xml version="1.0"?><urlset><url><loc>${fx.base}/about</loc></url><url><loc>${fx.base}/contact</loc></url><url><loc>https://other.example/x</loc></url></urlset>`;
  fx.server.removeAllListeners('request');
  const routes: any = {
    '/sitemap.xml': (_q: any, r: any) => { r.writeHead(200, { 'content-type': 'application/xml' }); r.end(sm); },
    '/': (_q: any, r: any) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(pageHtml(`<a href="/about">About</a><a href="/hidden#x">Hidden</a><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`)); },
    '/about': (_q: any, r: any) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(pageHtml(state.broken ? '<form><input type="text"></form>' : '<p>About us</p>')); },
    '/hidden': (_q: any, r: any) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(pageHtml('<p>Only linked</p>')); },
    '/contact': (_q: any, r: any) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(pageHtml('<p>Contact</p>')); },
  };
  fx.server.on('request', (q: any, r: any) => { const h = routes[q.url.split('?')[0]]; if (h) return h(q, r); r.writeHead(404); r.end(); });
  app = await (await import('../../src/server.ts')).buildServer();
  db = await import('../../src/db.ts');
  ({ sentMail } = await import('../../src/lib/mailer.ts'));
  ({ workOnce } = await import('../../src/jobs/worker.ts'));
  ({ closeBrowser } = await import('../../src/lib/scanner.ts'));
  ({ sitemapUrls } = await import('../../src/lib/crawler.ts'));
});
after(async () => { await closeBrowser(); await app.close(); fx.server.close(); });

test('crawler respects sitemap, same-origin and the page cap', async () => {
  assert.deepEqual(await sitemapUrls(fx.base, 10), [`${fx.base}/about`, `${fx.base}/contact`]);
  assert.equal((await sitemapUrls(fx.base, 1)).length, 1);
});

test('discovery: robots.txt Sitemap lines, nested and gzipped sitemaps, other hosts ignored', async () => {
  const { gzipSync } = await import('node:zlib');
  const { discover } = await import('../../src/lib/crawler.ts');
  const f2 = await fixtureServer({});
  const B = f2.base, xml = (r: any, b: string | Buffer) => { r.writeHead(200, { 'content-type': 'application/xml' }); r.end(b); };
  const routes: any = {
    '/robots.txt': (_q: any, r: any) => { r.writeHead(200, { 'content-type': 'text/plain' }); r.end(`User-agent: *\nDisallow: /private\nSitemap: ${B}/sm/index.xml\nSitemap: https://other.example/sitemap.xml`); },
    '/sm/index.xml': (_q: any, r: any) => xml(r, `<sitemapindex><sitemap><loc>${B}/sm/a.xml.gz</loc></sitemap><sitemap><loc>${B}/sm/b.xml</loc></sitemap></sitemapindex>`),
    '/sm/a.xml.gz': (_q: any, r: any) => xml(r, gzipSync(`<urlset>${[1, 2, 3].map((n) => `<url><loc>${B}/p${n}</loc></url>`).join('')}<url><loc>${B}/private/x</loc></url></urlset>`)),
    '/sm/b.xml': (_q: any, r: any) => xml(r, `<urlset><url><loc>${B}/p4</loc></url><url><loc>${B}/doc.pdf</loc></url></urlset>`),
  };
  f2.server.removeAllListeners('request');
  f2.server.on('request', (q: any, r: any) => { const h = routes[q.url.split('?')[0]]; if (h) return h(q, r); r.writeHead(404); r.end(); });
  try {
    const d = await discover(B, 10);
    assert.deepEqual(d.pages, [1, 2, 3, 4].map((n) => `${B}/p${n}`));
    assert.equal(d.sitemapFiles.length, 3, 'index + 2 child sitemaps; other-host sitemap not fetched');
    const why = (u: string) => d.skipped.find((x) => x.url === u)?.reason;
    assert.equal(why(`${B}/private/x`), 'robots'); assert.equal(why(`${B}/doc.pdf`), 'file');
    assert.equal((await discover(B, 2)).pages.length, 2);
  } finally { f2.server.close(); }
});

test('scheduled scan → evidence trail, diff, alert, immutability, retention', async () => {
  const c = client(app);
  await c.post('/signup', { email: 'mon@example.com', password: 'a very long password' }, '/signup');
  db.run("UPDATE teams SET plan = 'starter'");
  const r = await c.post('/app/sites', { name: 'Fixture', origin: fx.base });
  const sitePath = r.headers.location as string;
  state.token = (await c.req('GET', sitePath)).body.match(/content="([0-9a-f]{32})"/)![1];
  await c.post(sitePath + '/verify', {}, sitePath);
  const site = db.get('SELECT * FROM sites');
  assert.ok(site.next_scan_at > new Date(Date.now() + 6 * 86400_000).toISOString(), 'weekly schedule for Starter');
  assert.equal(await workOnce({}), true);
  const s1 = db.get("SELECT * FROM scans WHERE kind = 'scheduled'");
  assert.equal(s1.status, 'done'); assert.equal(s1.pages_scanned, 4, 'home + 2 sitemap pages + 1 linked page');
  // crawl coverage is recorded with skip reasons; scan_pages keeps final URLs so counts line up with issues
  const crawl = JSON.parse(s1.crawl);
  assert.equal(crawl.fromSitemap, 2); assert.equal(crawl.fromLinks, 1); assert.equal(crawl.robots, 'none');
  assert.equal(crawl.skipped.other_host.n, 1); assert.deepEqual(crawl.skipped.other_host.examples, ['https://other.example/x']);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM scan_pages WHERE scan_id = ? AND url = ?", s1.id, fx.base + '/').n, 1, 'final URL stored for the home page');
  const { scanSummary } = await import('../../src/lib/scanSummary.ts');
  const sum = scanSummary(s1.id);
  assert.equal(sum.elements, s1.critical + s1.serious + s1.moderate + s1.minor, 'element count matches the impact counts');
  assert.equal(sum.byPage.reduce((n: number, p: any) => n + p.elements, 0), sum.elements, 'top pages add up to the summary');
  assert.equal(sum.byRule.reduce((n: number, r: any) => n + r.elements.length, 0), sum.elements, 'rules add up to the summary');
  assert.equal(sum.occurrences, sum.byRule.reduce((n: number, r: any) => n + r.pages, 0));
  const page1 = (await c.req('GET', `/app/scans/${s1.id}`)).body;
  assert.match(page1, new RegExp(`data-counts>${sum.elements} affected element`));
  assert.match(page1, /id="coverage-h">Crawl coverage</); assert.match(page1, /data-reason="other_host"/);
  assert.match(page1, /<th scope="col">CSS selector<\/th>/); assert.match(page1, /How to fix/);
  assert.match(page1, /report\.pdf\?language=de/);
  assert.ok(s1.critical + s1.serious >= 1); assert.equal(s1.new_issues, null); assert.match(s1.evidence_hash, /^[0-9a-f]{64}$/);
  // break a page, run a manual scan
  state.broken = true;
  const before = sentMail.length;
  await c.post(sitePath + '/scan', {}, sitePath);
  await workOnce({});
  const s2 = db.get("SELECT * FROM scans WHERE kind = 'manual'");
  assert.ok(s2.new_issues >= 1); assert.equal(s2.fixed_issues, 0); assert.equal(s2.prev_hash, s1.evidence_hash, 'hash chain links to previous scan');
  assert.ok(sentMail.slice(before).some((m) => /new serious accessibility issue/.test(m.subject)), 'alert email sent');
  // dashboard polish: status JSON for the progress bar, score ring + KPIs, danger zone lives in Settings
  const st = JSON.parse((await c.req('GET', sitePath + '/scan-status')).body);
  assert.equal(st.pending, false); assert.equal(st.running, null); assert.equal(st.last.id, s2.id); assert.equal(st.last.newIssues, s2.new_issues);
  const sp = (await c.req('GET', sitePath)).body;
  assert.match(sp, /class="ring"[^>]*role="img"[^>]*aria-label="Automated checks score: \d+ out of 100"[^>]*aria-describedby="site-score-note"/);
  assert.match(sp, /id="site-score-note">Automated testing catches only part of accessibility issues \(about 57%, per Deque\)\. This score is not a full accessibility audit or legal assessment\./);
  const sd = (await c.req('GET', `/app/scans/${s2.id}`)).body;
  assert.match(sd, /aria-describedby="scan-score-note"/); assert.match(sd, />Automated checks score</);
  assert.match(sp, /data-scan-form/); assert.doesNotMatch(sp, /action="[^"]+\/delete"/, 'no remove button on the site page');
  assert.match((await c.req('GET', '/app/settings')).body, /id="danger-h"[\s\S]*\/delete"/);
  // scan detail page renders the diff
  const detail = await c.req('GET', `/app/scans/${s2.id}`);
  assert.match(detail.body, /<\/strong> new and <strong>/); assert.match(detail.body, /57%/);
  // immutability
  assert.throws(() => db.run('UPDATE scan_issues SET impact = ? WHERE scan_id = ?', 'minor', s1.id), /immutable/);
  assert.throws(() => db.run('UPDATE scans SET critical = 0 WHERE id = ?', s1.id), /immutable/);
  // retention: a 13-month-old scan is purged for Starter (12 months)
  const old = new Date(); old.setUTCMonth(old.getUTCMonth() - 13);
  db.run("INSERT INTO scans (id, site_id, kind, status, created_at) VALUES ('old', ?, 'scheduled', 'done', ?)", site.id, old.toISOString());
  const { applyRetention } = await import('../../src/jobs/siteScan.ts');
  assert.equal(applyRetention(), 1);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM scans WHERE id = 'old'").n, 0);
});

test('reports: PDF gating, white-label branding, statement draft', async () => {
  const c = client(app);
  await c.post('/login', { email: 'mon@example.com', password: 'a very long password' }, '/login');
  const scan = db.get("SELECT * FROM scans WHERE kind = 'manual'");
  let r = await c.req('GET', `/app/scans/${scan.id}/report.pdf`);
  assert.equal(r.statusCode, 200, 'Starter includes PDF export'); assert.equal(r.headers['content-type'], 'application/pdf');
  db.run("UPDATE teams SET plan = 'none'");
  r = await c.req('GET', `/app/scans/${scan.id}/report.pdf`);
  assert.equal(r.statusCode, 303, 'No plan: no PDF export');
  r = await c.req('GET', `/app/scans/${scan.id}/report`);
  assert.equal(r.statusCode, 303, 'No plan: no printable HTML report either');
  assert.doesNotMatch((await c.req('GET', `/app/scans/${scan.id}`)).body, /\/report"/, 'printable link hidden without PDF entitlement');
  db.run("UPDATE teams SET plan = 'agency'");
  r = await c.post('/app/team/branding', { brand_name: 'Pixel Agency', brand_color: '#ffff00', brand_logo_url: '' }, '/app/team');
  assert.match(decodeURIComponent(r.headers.location), /contrast/);
  r = await c.post('/app/team/branding', { brand_name: 'Pixel Agency', brand_color: '#7c2d12', brand_logo_url: '' }, '/app/team');
  assert.match(decodeURIComponent(r.headers.location), /Branding saved/);
  r = await c.req('GET', `/app/scans/${scan.id}/report`);
  assert.match(r.body, /Pixel Agency/); assert.match(r.body, /#7c2d12/); assert.match(r.body, /57%/);
  assert.match(r.body, /Automated checks score<\/b>/); assert.match(r.body, /aria-describedby="score-note"/); assert.match(r.body, /not a full accessibility audit or legal assessment/);
  r = await c.req('GET', `/app/scans/${scan.id}/report.pdf`);
  assert.equal(r.statusCode, 200); assert.equal(r.headers['content-type'], 'application/pdf');
  assert.equal(r.rawPayload.subarray(0, 4).toString(), '%PDF');
  // German report: localized headings, per-rule details with selector + snippet, coverage, no banned words
  r = await c.req('GET', `/app/scans/${scan.id}/report?language=de`);
  assert.match(r.body, /<html lang="de"/); assert.match(r.body, /Details nach Regel/); assert.match(r.body, /So beheben Sie es|Behebung/);
  assert.match(r.body, /Abdeckung der Prüfung/); assert.match(r.body, /<pre/);
  assert.doesNotMatch(r.body, new RegExp(['konf' + 'orm', 'zertifizi', 'garanti', 'complian', 'certifi', 'guarant'].join('|'), 'i'), 'no banned claims');
  r = await c.req('GET', `/app/scans/${scan.id}/report?language=zh-CN`);
  assert.match(r.body, /<html lang="zh-CN"/); assert.match(r.body, /各规则详情/);
  r = await c.req('GET', `/app/scans/${scan.id}/report.pdf?language=de`);
  assert.equal(r.statusCode, 200); assert.equal(r.rawPayload.subarray(0, 4).toString(), '%PDF');
  r = await c.req('GET', `/app/sites/${scan.site_id}/statement`);
  assert.match(r.body, /DRAFT generated by Allyfolio/); assert.doesNotMatch(r.body, /complian|certified|guarantee/i);
});

test('scan button: "Scan queued…" only while queued, "Scanning…" while running, disabled both times', async () => {
  const c = client(app);
  await c.post('/login', { email: 'mon@example.com', password: 'a very long password' }, '/login');
  db.run("UPDATE teams SET plan = 'starter'");
  const site = db.get('SELECT * FROM sites');
  const btn = async () => (await c.req('GET', `/app/sites/${site.id}`)).body.match(/<form[^>]*data-scan-form[^>]*>[\s\S]*?(<button[^>]*>[^<]*<\/button>)/)![1];
  assert.match(await btn(), /^<button class="btn btn-primary" type="submit" >Scan now<\/button>$/);
  db.run("INSERT INTO jobs (type, payload, run_at, created_at) VALUES ('site_scan', ?, '2026-01-01', '2026-01-01')", JSON.stringify({ siteId: site.id, kind: 'manual' }));
  assert.match(await btn(), /disabled aria-busy="true">Scan queued…</);
  db.run("INSERT INTO scans (id, site_id, kind, status, created_at, started_at, pages_scanned, page_limit) VALUES ('run1', ?, 'manual', 'running', '2099-01-01', '2099-01-01', 44, 200)", site.id);
  assert.match(await btn(), /disabled aria-busy="true">Scanning…</);
  const page = (await c.req('GET', `/app/sites/${site.id}`)).body;
  assert.match(page, /data-btn-scanning="Scanning…"/); assert.match(page, /data-btn-queued="Scan queued…"/);
  const st = JSON.parse((await c.req('GET', `/app/sites/${site.id}/scan-status`)).body);
  assert.equal(st.pending, true); assert.deepEqual(st.running, { pages: 44, limit: 200 });
  db.run("DELETE FROM jobs WHERE type = 'site_scan'"); db.run("DELETE FROM scans WHERE id = 'run1'");
});
