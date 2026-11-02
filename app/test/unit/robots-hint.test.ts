import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageSection, ROBOTS_ALLOW_SNIPPET } from '../../src/lib/scanSummary.ts';

const crawl = (robotsN: number) => JSON.stringify({ robots: 'rules', sitemapFiles: [], sitemapFileCount: 0, sitemapUrls: 0, fromSitemap: 0, fromLinks: 3, skipped: robotsN ? { robots: { n: robotsN, examples: ['https://ex.com/private'] } } : {} });
const s = (x: { __html: string }) => x.__html;

test('robots.txt notice: shown on finished scans with robots-skipped pages, in en/de/zh, with the AllyfolioBot allow snippet', () => {
  assert.equal(ROBOTS_ALLOW_SNIPPET, 'User-agent: AllyfolioBot\nAllow: /');
  const en = s(coverageSection({ id: 'a', status: 'done', crawl: crawl(2) }, 'en'));
  assert.match(en, /data-robots-hint/);
  assert.ok(en.includes("Some pages were skipped due to your site&#39;s robots.txt rules. As the verified site owner, you can ensure full coverage by adding the following lines to your robots.txt:") || en.includes("Some pages were skipped due to your site's robots.txt rules. As the verified site owner, you can ensure full coverage by adding the following lines to your robots.txt:"));
  assert.match(en, /<pre[^>]*><code>User-agent: AllyfolioBot\nAllow: \/<\/code><\/pre>/);
  assert.match(en, /href="https:\/\/allyfolio\.com\/bot"/);
  const de = s(coverageSection({ id: 'a', status: 'done', crawl: crawl(1) }, 'de'));
  assert.ok(de.includes('Einige Seiten wurden aufgrund der robots.txt-Regeln Ihrer Website übersprungen. Als verifizierter Eigentümer können Sie eine vollständige Prüfung sicherstellen, indem Sie Folgendes in Ihre robots.txt einfügen:'));
  assert.match(de, /allyfolio\.com\/de\/bot/);
  assert.match(s(coverageSection({ id: 'a', status: 'done', crawl: crawl(1) }, 'zh-CN')), /robots\.txt 规则而被跳过/);
  // admin-bypass teams get neutral wording
  const managed = s(coverageSection({ id: 'a', status: 'done', crawl: crawl(1) }, 'en', 'coverage-h', { managed: true }));
  assert.match(managed, /If you manage this site/); assert.doesNotMatch(managed, /verified site owner/);
});

test('robots.txt notice: hidden without robots skips or before the scan is done', () => {
  assert.doesNotMatch(s(coverageSection({ id: 'a', status: 'done', crawl: crawl(0) }, 'en')), /data-robots-hint/);
  assert.doesNotMatch(s(coverageSection({ id: 'a', status: 'running', crawl: crawl(3) }, 'en')), /data-robots-hint/);
});
