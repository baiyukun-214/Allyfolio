import { en, type Dict } from './en';
import { zh } from './zh';
export type Locale = 'en' | 'zh-CN';
export const LOCALES: Locale[] = ['en', 'zh-CN'];
const dicts: Record<Locale, Dict> = { en, 'zh-CN': zh };
export const prefix = (l: Locale) => (l === 'zh-CN' ? '/zh' : '');
/** Strip a locale prefix and .html suffix → the locale-independent page path ("/" for home). */
export function basePath(pathname: string): string {
  let p = pathname.replace(/\.html$/, '').replace(/\/index$/, '');
  p = p.replace(/^\/zh(?=\/|$)/, '');
  return p === '' ? '/' : p;
}
export const localeFromPath = (pathname: string): Locale => (/^\/zh(\/|\.html$|$)/.test(pathname) ? 'zh-CN' : 'en');
export function localize(path: string, l: Locale): string {
  if (/^(https?:|mailto:)/.test(path)) return path;
  const [p, hash] = path.split('#');
  const out = l === 'en' ? p || '/' : p === '/' || p === '' ? '/zh' : `/zh${p}`;
  return hash !== undefined ? `${out === '/zh' && p === '/' ? '/zh' : out}#${hash}` : out;
}
export function i18n(pathname: string) {
  const lang = localeFromPath(pathname);
  return { lang, t: dicts[lang], l: (p: string) => localize(p, lang), other: (lang === 'en' ? 'zh-CN' : 'en') as Locale };
}
export const dict = (l: Locale) => dicts[l];
