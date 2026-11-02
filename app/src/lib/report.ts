import { clientOfSite } from './clients.ts';
import { get } from '../db.ts';
import { html, type Html } from './html.ts';
import { IMPACTS } from './scanner.ts';
import { t, type ReportLocale } from '../i18n.ts';
import { config } from '../config.ts';
import { scanSummary, coverageSection, guidance, ruleTitle, snippet } from './scanSummary.ts';
import { planOf } from './plans.ts';
import { safeFetch } from './ssrf.ts';
import { browser } from './scanner.ts';
import { readFileSync } from 'node:fs';
const FONT = 'data:font/woff2;base64,' + readFileSync(new URL('../../public/inter.woff2', import.meta.url)).toString('base64');
import { raw } from './html.ts';
import { automatedScore } from './insights.ts';
import { checklist, summary as manualSummary, verifyEvidence, CRITERIA_DE } from './manualReview.ts';
/** Affected elements listed per rule in the PDF; the app lists all. */
export const PDF_ELEMENTS_PER_RULE = 10;

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
const fmt = (iso: string, l: ReportLocale) => new Date(iso).toLocaleString(t(l).dateLocale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

export function reportHtml(scanId: string, b: Branding, l: ReportLocale = 'en'): string {
  const Tx = t(l), R = Tx.rep, C = Tx.cov;
  const scan = get<any>('SELECT c.*, s.name AS site_name, s.origin FROM scans c JOIN sites s ON s.id = c.site_id WHERE c.id = ?', scanId);
  const S = scanSummary(scanId), appLink = `${config.appUrl}/app/scans/${scanId}`;
  const X = Tx.manual, manual = checklist(scan.site_id).filter((r) => r.status !== 'not_checked'), msum = manualSummary(scan.site_id), mev = verifyEvidence(scan.site_id);
  const client = clientOfSite(scan.site_id);
  const sorted = S.byRule;
  const body: Html = html`<!doctype html><html lang="${Tx.htmlLang}"><head><meta charset="utf-8"><title>${R.title(scan.site_name)}</title><style>
    @font-face { font-family: Inter; src: url(${raw(FONT)}) format('woff2'); font-weight: 100 900; }
    body { font-family: Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", Arial, sans-serif; color: #0f172a; margin: 0; padding: 40px; font-size: 12px; line-height: 1.5; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid ${b.color}; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { font-weight: 700; font-size: 18px; color: ${b.color}; display: flex; gap: 10px; align-items: center; } .brand img { max-height: 40px; max-width: 160px; }
    h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; color: ${b.color}; }
    .muted { color: #475569; } table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; } th { color: #475569; font-weight: 600; }
    .stats { display: flex; gap: 12px; } .stat { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; } .stat b { display: block; font-size: 22px; }
    .note { background: #eef2ff; border-left: 4px solid #3b5bdb; padding: 10px 14px; border-radius: 6px; margin: 16px 0; }
    .vs-last { margin: 12px 0 0; font-size: 13px; } .score { border-top: 1px solid #e2e8f0; padding: 8px 0 0; margin: 12px 0; font-size: 10px; } .score .v { font-weight: 600; } .score p { margin: 2px 0 0; }
    code { font-size: 10px; word-break: break-all; } h3 { font-size: 13px; margin: 18px 0 4px; break-after: avoid; } .rule { break-inside: avoid-page; }
    .guide { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 4px 0; } .guide dt { font-weight: 600; color: #334155; } .guide dd { margin: 0; }
    .links a { color: ${b.color}; } .el { table-layout: fixed; } .el td { font-size: 10px; } .el pre { white-space: pre-wrap; word-break: break-all; margin: 0; font-size: 9px; font-family: ui-monospace, Menlo, Consolas, monospace; }
    .cap { caption-side: top; text-align: left; font-weight: 600; padding: 4px 0; } .pill { display: inline-block; border-radius: 999px; padding: 0 8px; background: #f1f5f9; font-size: 10px; font-weight: 600; } footer { margin-top: 32px; font-size: 10px; color: #475569; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  </style></head><body>
  <header><div class="brand">${b.logoDataUri ? html`<img src="${b.logoDataUri}" alt="${b.name}">` : ''}<span>${b.name}</span></div><div class="muted">${R.kind}</div></header>
  <main>
  ${client ? html`<p class="muted" style="margin:0 0 4px">${Tx.cl.pdfFor(client.name)}</p>` : ''}
  <h1>${scan.site_name}</h1>
  <p class="muted">${scan.origin} · ${R.finished} ${fmt(scan.finished_at, l)} · ${R.pagesChecked(scan.pages_scanned, scan.page_limit)}</p>
  <p><b>${C.counts(S.elements, S.rules, S.occurrences, S.pagesWithIssues)}</b></p>
  <p class="muted" style="margin-top:0">${C.countsHelp}</p>
  <h2 style="margin-top:8px">${C.byImpact}</h2>
  <div class="stats">${IMPACTS.map((k) => html`<div class="stat"><span class="muted">${Tx.impacts[k]}</span><b>${scan[k]}</b></div>`)}</div>
  ${scan.new_issues != null ? html`<p class="vs-last"><b>${R.compared(scan.new_issues, scan.fixed_issues)}</b></p>` : ''}
  <section class="score" aria-labelledby="score-h" aria-describedby="score-note"><p><b id="score-h">${Tx.mon.score}:</b> <span class="v">${automatedScore(scan)}</span> <span class="muted">${Tx.mon.scoreOutOf}</span></p><p class="muted" id="score-note">${Tx.mon.scoreNote}</p></section>
  <div class="note"><b>${R.coversH}</b> ${R.covers}</div>
  <h2>${R.byRule}</h2>
  <table><thead><tr><th>${R.colImpact}</th><th>${R.colIssue}</th><th>${R.colWcag}</th><th>${C.colElements}</th><th>${C.colPages}</th></tr></thead><tbody>
  ${sorted.map((i) => html`<tr><td>${Tx.impacts[i.impact] ?? i.impact}</td><td>${ruleTitle(i, l)}</td><td>${i.wcag || Tx.mon.bestPractice}</td><td>${i.elements.length}</td><td>${i.pages}</td></tr>`)}
  </tbody></table>
  ${!sorted.length ? html`<p>${R.none}</p>` : ''}
  <h2>${C.topPages}</h2>
  <table><thead><tr><th>${R.colPage}</th><th>${C.colElements}</th><th>${C.colRules}</th></tr></thead><tbody>${S.byPage.slice(0, 50).map((p) => html`<tr><td>${p.url}</td><td>${p.elements}</td><td>${p.rules}</td></tr>`)}</tbody></table>
  ${coverageSection(scan, l, 'coverage')}
  ${sorted.length ? html`<h2>${C.detailsH}</h2>
  ${sorted.map((r) => { const shown = r.elements.slice(0, PDF_ELEMENTS_PER_RULE); return html`<section class="rule" data-rule="${r.ruleId}">
    <h3><span class="pill">${Tx.impacts[r.impact] ?? r.impact}</span> ${ruleTitle(r, l)} <span class="muted">(${r.ruleId})</span></h3>
    ${guidance(r, l)}
    <table class="el"><caption class="cap">${C.elementsCaption(ruleTitle(r, l))}</caption><colgroup><col style="width:30%"><col style="width:28%"><col style="width:42%"></colgroup>
    <thead><tr><th>${C.colPageUrl}</th><th>${C.colSelector}</th><th>${C.colHtml}</th></tr></thead><tbody>
    ${shown.map((e) => html`<tr><td><code>${e.pageUrl}</code></td><td><code>${e.target}</code></td><td><pre>${snippet(e.html)}</pre></td></tr>`)}</tbody></table>
    ${r.elements.length > shown.length ? html`<p class="muted">${C.shown(shown.length, r.elements.length)} ${C.moreInApp(r.elements.length - shown.length, appLink)}</p>` : ''}
  </section>`; })}` : ''}
  <h2>${X.h}</h2>
  <p class="muted">${X.pdfLead}</p>
  <p>${X.summary(msum)}</p>
  ${manual.length ? html`<table><thead><tr><th>${X.colCriterion}</th><th>${X.colLevel}</th><th>${X.colStatus}</th><th>${X.colNotes}</th><th>${X.colLast}</th></tr></thead><tbody>
  ${manual.map((r) => html`<tr><td>${r.criterion} ${l === 'zh-CN' ? r.zh : l === 'de' ? CRITERIA_DE[r.criterion] ?? r.en : r.en}</td><td>${r.level}</td><td>${X.statuses[r.status]}</td><td>${r.notes ?? ''}</td><td>${r.checked_at ? fmt(r.checked_at, l) : '–'}${r.checked_by_email ? html`<br>${X.lastBy(r.checked_by_email)}` : ''}</td></tr>`)}
  </tbody></table>` : html`<p>${X.pdfNone}</p>`}
  ${mev.count ? html`<p>${X.pdfEv(mev.count, mev.ok)}<br>${X.evLatest} <code>${mev.head}</code></p>` : ''}
  <h2>${R.evidence}</h2>
  <p>${R.evidenceText}</p>
  <p>${R.scanId} <code>${scan.id}</code><br>${R.hash} <code>${scan.evidence_hash}</code><br>${R.prev} <code>${scan.prev_hash ?? R.firstScan}</code></p>
  </main>
  <footer>${b.whiteLabel ? R.preparedBy(b.name) : R.generated} ${R.notLegal}</footer>
  </body></html>`;
  return body.__html;
}

export async function reportPdf(scanId: string, b: Branding, l: ReportLocale = 'en'): Promise<Buffer> {
  const R = t(l).rep;
  const br = await browser();
  const ctx = await br.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  // Report is fully self-contained (inlined font + logo); the renderer may not touch the network.
  await page.route('**/*', (r) => r.request().url().startsWith('data:') ? r.continue() : r.abort());
  try {
    await page.setContent(reportHtml(scanId, b, l), { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#475569">${R.page} <span class="pageNumber"></span> ${R.of} <span class="totalPages"></span></div>` });
  } finally { await ctx.close(); }
}
