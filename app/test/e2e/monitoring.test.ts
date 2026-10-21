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
  assert.match(sp, /id="site-score-note">Automated testing catches only part of accessibility issues \(about 57%, per Deque\)\. This score is not a conformance rating or legal assessment\./);
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
  assert.equal(r.statusCode, 303, 'Starter has no PDF export');
  db.run("UPDATE teams SET plan = 'agency'");
  r = await c.post('/app/team/branding', { brand_name: 'Pixel Agency', brand_color: '#ffff00', brand_logo_url: '' }, '/app/team');
  assert.match(decodeURIComponent(r.headers.location), /contrast/);
  r = await c.post('/app/team/branding', { brand_name: 'Pixel Agency', brand_color: '#7c2d12', brand_logo_url: '' }, '/app/team');
  assert.match(decodeURIComponent(r.headers.location), /Branding saved/);
  r = await c.req('GET', `/app/scans/${scan.id}/report`);
  assert.match(r.body, /Pixel Agency/); assert.match(r.body, /#7c2d12/); assert.match(r.body, /57%/);
  assert.match(r.body, /Automated checks score<\/b>/); assert.match(r.body, /aria-describedby="score-note"/); assert.match(r.body, /not a conformance rating or legal assessment/);
  r = await c.req('GET', `/app/scans/${scan.id}/report.pdf`);
  assert.equal(r.statusCode, 200); assert.equal(r.headers['content-type'], 'application/pdf');
  assert.equal(r.rawPayload.subarray(0, 4).toString(), '%PDF');
  r = await c.req('GET', `/app/sites/${scan.site_id}/statement`);
  assert.match(r.body, /DRAFT generated by Allyfolio/); assert.doesNotMatch(r.body, /complian|certified|guarantee/i);
});
