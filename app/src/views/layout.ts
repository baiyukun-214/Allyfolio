import { html, type Html } from '../lib/html.ts';
import { t, type Locale } from '../i18n.ts';
import { config } from '../config.ts';
/** Allyfolio mark (direction B). Decorative: the link carries the accessible name. Keep in sync with site/src/components/Logo.astro. */
const logo = html`<svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="16" fill="#4f46e5"/><path d="M16 14h18l10 10v26a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill="none" stroke="#fff" stroke-width="4.5" stroke-linejoin="round"/><path d="M20 27h12M20 35h8" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M40 40a8 8 0 0 1 8 8M40 31a17 17 0 0 1 17 17" fill="none" stroke="#c7d2fe" stroke-width="4.5" stroke-linecap="round"/><circle cx="40" cy="48" r="3.5" fill="#c7d2fe"/></svg>`;
export interface PageOpts { title: string; body: Html; user?: { email: string } | null; current?: string; flash?: { kind: 'ok' | 'error'; msg: string } | null; locale?: Locale; path?: string; backToSite?: boolean }
/** Marketing-site URL in the given locale (Chinese lives under /zh). */
export const siteLink = (l: Locale, path = '/') => `${config.siteUrl}${l === 'zh-CN' ? (path === '/' ? '/zh' : '/zh' + path) : path}`;
export function langSwitch(locale: Locale, path = '/') {
  const T = t(locale); const other: Locale = locale === 'en' ? 'zh-CN' : 'en';
  return html`<a class="lang-switch" href="/lang?to=${other}&amp;next=${encodeURIComponent(path)}" hreflang="${other}" lang="${other}" aria-label="${T.switchAria}"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg><span>${T.switchLabel}</span></a>`;
}
export function page({ title, body, user, current, flash, locale = 'en', path = '/', backToSite }: PageOpts): string {
  const T = t(locale), L = T.layout;
  const links = user ? [['/app', L.sites], ['/app/team', L.team], ['/app/billing', L.billing], ['/app/settings', L.settings]] : [];
  const siteNav = html`<nav class="sitebar" aria-label="${L.site}"><div class="in"><ul>
    <li><a href="${siteLink(locale)}">${L.website}</a></li><li><a href="${siteLink(locale, '/blog')}">${L.blog}</a></li><li><a href="${siteLink(locale, '/pricing')}">${L.pricing}</a></li></ul></div></nav>`;
  return '<!doctype html>' + html`<html lang="${T.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Allyfolio</title><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/app.css"><script src="/static/app.js" defer></script></head>
<body><a class="skip" href="#main">${L.skip}</a>
<header class="top">${user ? siteNav : ''}<div class="in"><a class="brand" href="${siteLink(locale)}" aria-label="${L.homeAria}">${logo}<span>Allyfolio</span></a>
<nav class="main" aria-label="${L.main}"><ul>${links.map(([h, l]) => html`<li><a href="${h}" ${current === h ? html`aria-current="page"` : ''}>${l}</a></li>`)}
<li>${langSwitch(locale, path)}</li>
${user ? html`<li><form method="post" action="/logout"><button class="btn btn-secondary" type="submit">${L.logout}<span class="sr-only"> ${user.email}</span></button></form></li>` : html`<li><a href="/login">${L.login}</a></li><li><a class="btn btn-primary" href="/signup">${L.signup}</a></li>`}
</ul></nav></div></header>
<main id="main" tabindex="-1">${backToSite ? html`<p class="back-site"><a href="${siteLink(locale)}">${L.backToSite}</a></p>` : ''}${flash ? html`<div class="alert alert-${flash.kind}" role="${flash.kind === 'error' ? 'alert' : 'status'}">${flash.msg}</div>` : ''}${body}<div class="toasts" id="toasts" role="status" aria-live="polite"></div></main>
<footer><div class="in"><p>${L.footer}</p><ul class="footlinks"><li><a href="${siteLink(locale)}">${L.website}</a></li><li><a href="${siteLink(locale, '/blog')}">${L.blog}</a></li><li><a href="${siteLink(locale, '/pricing')}">${L.pricing}</a></li></ul></div></footer>
</body></html>`.__html;
}
