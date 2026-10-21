import { all, get } from '../db.ts';
import { html, type Html } from './html.ts';
import { IMPACTS } from './scanner.ts';
import { planOf } from './plans.ts';
import { safeFetch } from './ssrf.ts';
import { browser } from './scanner.ts';
import { readFileSync } from 'node:fs';
const FONT = 'data:font/woff2;base64,' + readFileSync(new URL('../../public/inter.woff2', import.meta.url)).toString('base64');
import { raw } from './html.ts';

export interface Branding { name: string; color: string; logoDataUri: string | null; whiteLabel: boolean }
/** Logo is fetched server-side through the SSRF guard and inlined, so the PDF renderer never touches the network. */
export async function brandingFor(team: any): Promise<Branding> {
  const plan = planOf(team.plan);
  if (!plan.whiteLabel || !team.brand_name) return { name: 'Allyfolio', color: '#1e3a8a', logoDataUri: null, whiteLabel: false };
  let logo: string | null = null;
  if (team.brand_logo_url) {
    try {
      const r = await safeFetch(team.brand_logo_url, { timeoutMs: 8000 });
      const type = r.headers.get('content-type') ?? '';
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.ok && /^image\/(png|jpeg|webp|gif)$/.test(type.split(';')[0]) && buf.length < 512_000) logo = `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
    } catch {}
  }
  return { name: team.brand_name, color: team.brand_color || '#1e3a8a', logoDataUri: logo, whiteLabel: true };
}
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

export function reportHtml(scanId: string, b: Branding): string {
  const scan = get<any>('SELECT c.*, s.name AS site_name, s.origin FROM scans c JOIN sites s ON s.id = c.site_id WHERE c.id = ?', scanId);
  const issues = all<any>('SELECT rule_id, impact, help, help_url, wcag, COUNT(*) AS n, COUNT(DISTINCT page_url) AS pages FROM scan_issues WHERE scan_id = ? GROUP BY rule_id ORDER BY n DESC', scanId);
  const pages = all<any>('SELECT p.url, (SELECT COUNT(*) FROM scan_issues i WHERE i.scan_id = p.scan_id AND i.page_url = p.url) AS n FROM scan_pages p WHERE p.scan_id = ? ORDER BY n DESC LIMIT 50', scanId);
  const sorted = issues.sort((a, c) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(c.impact) || c.n - a.n);
  const body: Html = html`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Accessibility report – ${scan.site_name}</title><style>
    @font-face { font-family: Inter; src: url(${raw(FONT)}) format('woff2'); font-weight: 100 900; }
    body { font-family: Inter, Arial, sans-serif; color: #0f172a; margin: 0; padding: 40px; font-size: 12px; line-height: 1.5; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid ${b.color}; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { font-weight: 700; font-size: 18px; color: ${b.color}; display: flex; gap: 10px; align-items: center; } .brand img { max-height: 40px; max-width: 160px; }
    h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; color: ${b.color}; }
    .muted { color: #475569; } table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; } th { color: #475569; font-weight: 600; }
    .stats { display: flex; gap: 12px; } .stat { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; } .stat b { display: block; font-size: 22px; }
    .note { background: #eef2ff; border-left: 4px solid #3b5bdb; padding: 10px 14px; border-radius: 6px; margin: 16px 0; }
    code { font-size: 10px; word-break: break-all; } footer { margin-top: 32px; font-size: 10px; color: #475569; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  </style></head><body>
  <header><div class="brand">${b.logoDataUri ? html`<img src="${b.logoDataUri}" alt="${b.name}">` : ''}<span>${b.name}</span></div><div class="muted">Accessibility scan report</div></header>
  <h1>${scan.site_name}</h1>
  <p class="muted">${scan.origin} · scan finished ${fmt(scan.finished_at)} · ${scan.pages_scanned} pages checked (limit ${scan.page_limit})</p>
  <div class="stats">${IMPACTS.map((k) => html`<div class="stat"><span class="muted">${k[0].toUpperCase() + k.slice(1)}</span><b>${scan[k]}</b></div>`)}</div>
  ${scan.new_issues != null ? html`<p>Compared with the previous scan: <b>${scan.new_issues}</b> new, <b>${scan.fixed_issues}</b> fixed.</p>` : ''}
  <div class="note"><b>What this report covers.</b> It lists issues found by automated checks (axe-core in a real Chromium browser) against WCAG 2.0–2.2 level A and AA rules. Automated testing finds roughly 57% of accessibility issues (Deque study). It does not show that the site meets WCAG or the European Accessibility Act; manual review by people is still needed.</div>
  <h2>Issues by rule</h2>
  <table><thead><tr><th>Impact</th><th>Issue</th><th>WCAG</th><th>Elements</th><th>Pages</th></tr></thead><tbody>
  ${sorted.map((i) => html`<tr><td>${i.impact}</td><td>${i.help}</td><td>${i.wcag || 'Best practice'}</td><td>${i.n}</td><td>${i.pages}</td></tr>`)}
  </tbody></table>
  ${!sorted.length ? html`<p>No issues found by automated checks.</p>` : ''}
  <h2>Pages with the most issues</h2>
  <table><thead><tr><th>Page</th><th>Issues</th></tr></thead><tbody>${pages.map((p) => html`<tr><td>${p.url}</td><td>${p.n}</td></tr>`)}</tbody></table>
  <h2>Evidence</h2>
  <p>This scan is stored unchanged in a timestamped history. Its evidence hash links it to the previous scan, so later edits would be detectable.</p>
  <p>Scan ID <code>${scan.id}</code><br>Evidence hash (SHA-256) <code>${scan.evidence_hash}</code><br>Previous hash <code>${scan.prev_hash ?? '– (first scan)'}</code></p>
  <footer>${b.whiteLabel ? `Prepared by ${b.name}.` : 'Generated by Allyfolio.'} This report is documentation of automated testing, not legal advice.</footer>
  </body></html>`;
  return body.__html;
}

export async function reportPdf(scanId: string, b: Branding): Promise<Buffer> {
  const br = await browser();
  const ctx = await br.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  // Report is fully self-contained (inlined font + logo); the renderer may not touch the network.
  await page.route('**/*', (r) => r.request().url().startsWith('data:') ? r.continue() : r.abort());
  try {
    await page.setContent(reportHtml(scanId, b), { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#475569">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' });
  } finally { await ctx.close(); }
}
