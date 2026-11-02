import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, robotsAllows, classifyLink, siteScope, pageKey, parseSitemap } from '../../src/lib/crawler.ts';

test('robots.txt: own group wins over *, longest match, Allow wins ties, wildcards, Sitemap lines', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: AllyfolioBot\nDisallow: /checkout\nDisallow: /*.json$\nAllow: /checkout/help\nSitemap: https://shop.example/sitemap_index.xml\nSitemap: https://other.example/sitemap.xml`);
  assert.equal(robotsAllows(r, 'https://shop.example/'), true, 'specific group replaces *');
  assert.equal(robotsAllows(r, 'https://shop.example/checkout/cart'), false);
  assert.equal(robotsAllows(r, 'https://shop.example/checkout/help'), true, 'longer Allow wins');
  assert.equal(robotsAllows(r, 'https://shop.example/data.json'), false); assert.equal(robotsAllows(r, 'https://shop.example/data.json?x=1'), true, '$ anchors the end');
  assert.deepEqual(r.sitemaps, ['https://shop.example/sitemap_index.xml', 'https://other.example/sitemap.xml']);
  const star = parseRobots('User-agent: *\nDisallow: /admin\nDisallow:\n');
  assert.equal(robotsAllows(star, 'https://a.example/admin/x'), false); assert.equal(robotsAllows(star, 'https://a.example/about'), true);
  assert.equal(robotsAllows(parseRobots(''), 'https://a.example/x'), true);
});

test('links: www and apex are the same site, other hosts, files and long queries are skipped with a reason', () => {
  const scope = siteScope('https://shop.example');
  assert.deepEqual(classifyLink('/about#team', 'https://shop.example/', scope), { url: 'https://shop.example/about' });
  assert.deepEqual(classifyLink('https://www.shop.example/de/', 'https://shop.example/', scope), { url: 'https://www.shop.example/de/' });
  assert.deepEqual(classifyLink('http://shop.example/x', 'https://shop.example/', scope), { url: 'https://shop.example/x' }, 'forces the site protocol');
  assert.equal((classifyLink('https://blog.shop.example/', 'https://shop.example/', scope) as any).skip, 'other_host');
  assert.equal((classifyLink('/files/manual.PDF', 'https://shop.example/', scope) as any).skip, 'file');
  assert.equal((classifyLink('/s?' + 'q=x&'.repeat(80), 'https://shop.example/', scope) as any).skip, 'query');
  assert.equal(classifyLink('mailto:hi@shop.example', 'https://shop.example/', scope), null);
  assert.equal(classifyLink('javascript:void(0)', 'https://shop.example/', scope), null);
  assert.equal(siteScope('http://127.0.0.1:8080').hosts.size, 1, 'no www variant for IPs');
});

test('page keys ignore www, trailing slash and index.html', () => {
  assert.equal(pageKey('https://www.shop.example/a/'), pageKey('https://shop.example/a'));
  assert.equal(pageKey('https://shop.example/index.html'), pageKey('https://shop.example/'));
  assert.notEqual(pageKey('https://shop.example/a?x=1'), pageKey('https://shop.example/a'));
});

test('sitemaps: urlset and sitemap index, CDATA and entities', () => {
  const s = parseSitemap('<urlset><url><loc><![CDATA[https://a.example/x?a=1&b=2]]></loc></url><url><loc>https://a.example/y?a=1&amp;b=2</loc></url></urlset>');
  assert.deepEqual(s.pages, ['https://a.example/x?a=1&b=2', 'https://a.example/y?a=1&b=2']);
  const i = parseSitemap('<sitemapindex><sitemap><loc>https://a.example/s1.xml.gz</loc></sitemap></sitemapindex>');
  assert.deepEqual(i.sitemaps, ['https://a.example/s1.xml.gz']); assert.deepEqual(i.pages, []);
});

test('robots: the AllyfolioBot group (any case, optional version) overrides *, as recommended on /bot', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: AllyfolioBot\nAllow: /\n';
  const r = parseRobots(txt);
  assert.equal(robotsAllows(r, 'https://ex.com/'), true);
  assert.equal(robotsAllows(r, 'https://ex.com/shop/item?id=1'), true);
  for (const ua of ['allyfoliobot', 'ALLYFOLIOBOT', 'AllyfolioBot/0.1']) assert.equal(robotsAllows(parseRobots(`User-agent: *\nDisallow: /\nUser-agent: ${ua}\nAllow: /\n`), 'https://ex.com/a'), true, ua);
  // only "*" → its rules apply
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /private\n'), 'https://ex.com/private/x'), false);
  // our group replaces "*" entirely (no merging): * blocks /a, ours only blocks /b
  const own = parseRobots('User-agent: *\nDisallow: /a\nUser-agent: AllyfolioBot\nDisallow: /b\n');
  assert.equal(robotsAllows(own, 'https://ex.com/a'), true); assert.equal(robotsAllows(own, 'https://ex.com/b'), false);
  // other bots' groups and partial tokens are not ours
  for (const ua of ['bot', 'Googlebot', 'Allyfolio', '']) {
    const r2 = parseRobots(`User-agent: *\nDisallow: /\nUser-agent: ${ua}\nAllow: /\n`);
    assert.equal(robotsAllows(r2, 'https://ex.com/x'), false, `token "${ua}" must not match AllyfolioBot`);
  }
  // shared group: "User-agent: Googlebot" + "User-agent: AllyfolioBot" lines before the rules
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /\nUser-agent: Googlebot\nUser-agent: AllyfolioBot\nAllow: /\n'), 'https://ex.com/x'), true);
});
