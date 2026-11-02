import { all } from '../db.ts';
import { html, type Html } from './html.ts';
import { pageKey, SKIP_REASONS } from './crawler.ts';
import { IMPACTS, ruleHelp } from './scanner.ts';
import { ruleInfo, wcagLink } from './rule-info.ts';
import { t, type ReportLocale } from '../i18n.ts';

export interface RuleElement { pageUrl: string; target: string; html: string; fingerprint: string }
export interface RuleSummary { ruleId: string; impact: string; help: string; helpUrl: string; wcag: string; elements: RuleElement[]; pages: number }
export interface PageSummary { url: string; elements: number; rules: number }
export interface ScanSummary {
  /** One element on one page failing one rule (axe node). The impact counts on a scan are in this unit. */
  elements: number;
  /** Distinct rules with at least one affected element. */
  rules: number;
  /** One rule failing on one page, however many elements. */
  occurrences: number;
  pagesScanned: number; pagesWithIssues: number;
  byRule: RuleSummary[]; byPage: PageSummary[];
}

/** Counts and groupings for a scan. Issues are matched to pages by page key (host without www, path without trailing slash),
 *  so older scans that stored requested URLs in scan_pages and final URLs in scan_issues add up too. */
export function scanSummary(scanId: string): ScanSummary {
  const issues = all<any>('SELECT page_url, rule_id, impact, help, help_url, wcag, target, html, fingerprint FROM scan_issues WHERE scan_id = ? ORDER BY id', scanId);
  const pageRows = all<any>('SELECT url FROM scan_pages WHERE scan_id = ? AND error IS NULL ORDER BY url', scanId);
  const pages = new Map<string, { url: string; elements: number; rules: Set<string> }>();
  for (const p of pageRows) { const k = pageKey(p.url); if (!pages.has(k)) pages.set(k, { url: p.url, elements: 0, rules: new Set() }); }
  const rules = new Map<string, RuleSummary & { pageKeys: Set<string> }>();
  for (const i of issues) {
    const k = pageKey(i.page_url);
    const p = pages.get(k) ?? { url: i.page_url, elements: 0, rules: new Set<string>() }; pages.set(k, p);
    p.elements++; p.rules.add(i.rule_id);
    const r = rules.get(i.rule_id) ?? { ruleId: i.rule_id, impact: i.impact, help: i.help, helpUrl: i.help_url, wcag: i.wcag ?? '', elements: [] as RuleElement[], pages: 0, pageKeys: new Set<string>() };
    r.elements.push({ pageUrl: i.page_url, target: i.target, html: i.html ?? '', fingerprint: i.fingerprint }); r.pageKeys.add(k); rules.set(i.rule_id, r);
  }
  const byRule = [...rules.values()].map(({ pageKeys, ...r }) => ({ ...r, pages: pageKeys.size }))
    .sort((a, b) => IMPACTS.indexOf(a.impact as any) - IMPACTS.indexOf(b.impact as any) || b.elements.length - a.elements.length || a.ruleId.localeCompare(b.ruleId));
  const byPage = [...pages.values()].map((p) => ({ url: p.url, elements: p.elements, rules: p.rules.size })).sort((a, b) => b.elements - a.elements || a.url.localeCompare(b.url));
  return {
    elements: issues.length, rules: byRule.length, occurrences: byRule.reduce((n, r) => n + r.pages, 0),
    pagesScanned: pageRows.length, pagesWithIssues: byPage.filter((p) => p.elements).length, byRule, byPage,
  };
}

export interface Crawl { robots: string; sitemapFiles: string[]; sitemapFileCount: number; sitemapUrls: number; fromSitemap: number; fromLinks: number; skipped: Record<string, { n: number; examples: string[] }> }
export function crawlOf(scan: { crawl?: string | null }): Crawl | null { try { return scan.crawl ? JSON.parse(scan.crawl) : null; } catch { return null; } }

/** "Crawl coverage" section: how pages were found and why discovered URLs were not scanned, with counts by reason. */
export function coverageSection(scan: any, l: ReportLocale, id = 'coverage-h'): Html {
  const C = t(l).cov, crawl = crawlOf(scan);
  if (!crawl) return html`<section aria-labelledby="${id}"><h2 id="${id}">${C.coverageH}</h2><p class="muted">${C.noCrawl}</p></section>`;
  const rows = SKIP_REASONS.map((r) => [r, crawl.skipped[r]] as const).filter(([, v]) => v && v.n);
  return html`<section aria-labelledby="${id}"><h2 id="${id}">${C.coverageH}</h2>
    <p>${crawl.robots ? C.robots[crawl.robots] ?? '' : ''} ${C.sitemaps(crawl.sitemapFileCount, crawl.sitemapUrls)} ${C.sources(crawl.fromSitemap, crawl.fromLinks)}</p>
    ${rows.length ? html`<table class="cov"><caption class="cap">${C.skippedH}</caption><thead><tr><th scope="col">${C.colReason}</th><th scope="col">${C.colCount}</th><th scope="col">${C.examples}</th></tr></thead><tbody>
      ${rows.map(([r, v]) => html`<tr data-reason="${r}"><td>${C.reasons[r] ?? r}</td><td>${v!.n}</td><td>${v!.examples.slice(0, 3).map((u, i) => html`${i ? html`<br>` : ''}<code>${u}</code>`)}</td></tr>`)}
    </tbody></table>${crawl.skipped.other_host?.n ? html`<p class="muted">${C.otherHostHint}</p>` : ''}` : html`<p>${C.noSkips}</p>`}
  </section>`;
}

/** What / who / how to fix, plus rule guide and WCAG Understanding links, for one rule. */
export function guidance(r: RuleSummary, l: ReportLocale): Html {
  const C = t(l).cov, info = ruleInfo(r.ruleId, l);
  const refs = r.wcag ? r.wcag.split(/,\s*/).filter(Boolean) : [];
  return html`<dl class="guide"><dt>${C.what}</dt><dd>${info.what}</dd><dt>${C.who}</dt><dd>${info.who}</dd><dt>${C.fix}</dt><dd>${info.fix}</dd></dl>
    <p class="muted links"><a href="${r.helpUrl}">${C.ruleGuide}</a>${refs.map((ref) => { const w = wcagLink(ref); return html` · <a href="${w.url}">${C.wcagGuide}: ${ref}</a>`; })}</p>`;
}
export const ruleTitle = (r: RuleSummary, l: ReportLocale) => ruleHelp(r.ruleId, r.help, l);
export const snippet = (s: string, n = 300) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
