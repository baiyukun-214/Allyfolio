import { en, type Dict } from './en';
import { zh } from './zh';
import { de } from './de';
export type Locale = 'en' | 'zh-CN' | 'de';
export const LOCALES: Locale[] = ['en', 'zh-CN', 'de'];
/** Locales offered in the language switcher, hreflang and the sitemap. /zh stays online but is noindex and unlisted. */
export const PUBLIC_LOCALES: Locale[] = ['en', 'de'];
const dicts: Record<Locale, Dict> = { en, 'zh-CN': zh, de };
export const prefix = (l: Locale) => (l === 'zh-CN' ? '/zh' : l === 'de' ? '/de' : '');
/** Locale-independent paths that have a German page under /de. Everything else links to the English page. */
export const DE_PATHS = new Set(['/', '/pricing', '/free-scan', '/terms', '/privacy', '/refund', '/imprint', '/blog/what-the-eaa-means-for-smes']);
export const hasDe = (base: string) => DE_PATHS.has(base);
/** Strip a locale prefix and .html suffix → the locale-independent page path ("/" for home). */
export function basePath(pathname: string): string {
  let p = pathname.replace(/\.html$/, '').replace(/\/index$/, '');
  p = p.replace(/^\/(zh|de)(?=\/|$)/, '');
  return p === '' ? '/' : p;
}
export const localeFromPath = (pathname: string): Locale =>
  /^\/zh(\/|\.html$|$)/.test(pathname) ? 'zh-CN' : /^\/de(\/|\.html$|$)/.test(pathname) ? 'de' : 'en';
export function localize(path: string, l: Locale): string {
  if (/^(https?:|mailto:)/.test(path)) return path;
  const [p, hash] = path.split('#');
  const page = p || '/';
  // German exists only for a few pages; other links from German pages go to the English page.
  const loc = l === 'de' && !hasDe(page) ? 'en' : l;
  const pre = prefix(loc);
  const out = pre ? (page === '/' ? pre : `${pre}${page}`) : page;
  return hash !== undefined ? `${out}#${hash}` : out;
}
export function i18n(pathname: string) {
  const lang = localeFromPath(pathname);
  return { lang, t: dicts[lang], l: (p: string) => localize(p, lang) };
}
export const dict = (l: Locale) => dicts[l];
