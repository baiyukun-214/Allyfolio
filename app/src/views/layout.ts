import { html, type Html } from '../lib/html.ts';
import { t, type Locale } from '../i18n.ts';
const logo = html`<svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="16" fill="#1e3a8a"/><path d="M19 47 32 17l13 30" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M24.5 37h15" stroke="#a5b4fc" stroke-width="6" stroke-linecap="round"/></svg>`;
export interface PageOpts { title: string; body: Html; user?: { email: string } | null; current?: string; flash?: { kind: 'ok' | 'error'; msg: string } | null; locale?: Locale; path?: string }
export function langSwitch(locale: Locale, path = '/') {
  const T = t(locale); const other: Locale = locale === 'en' ? 'zh-CN' : 'en';
  return html`<a class="lang-switch" href="/lang?to=${other}&amp;next=${encodeURIComponent(path)}" hreflang="${other}" lang="${other}" aria-label="${T.switchAria}"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg><span>${T.switchLabel}</span></a>`;
}
export function page({ title, body, user, current, flash, locale = 'en', path = '/' }: PageOpts): string {
  const T = t(locale), L = T.layout;
  const links = user ? [['/app', L.sites], ['/app/team', L.team], ['/app/billing', L.billing], ['/app/settings', L.settings]] : [];
  return '<!doctype html>' + html`<html lang="${T.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Allyfolio</title><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/app.css"></head>
<body><a class="skip" href="#main">${L.skip}</a>
<header class="top"><div class="in"><a class="brand" href="${user ? '/app' : '/'}">${logo}<span>Allyfolio</span></a>
<nav class="main" aria-label="${L.main}"><ul>${links.map(([h, l]) => html`<li><a href="${h}" ${current === h ? html`aria-current="page"` : ''}>${l}</a></li>`)}
<li>${langSwitch(locale, path)}</li>
${user ? html`<li><form method="post" action="/logout"><button class="btn btn-secondary" type="submit">${L.logout}<span class="sr-only"> ${user.email}</span></button></form></li>` : html`<li><a href="/login">${L.login}</a></li><li><a class="btn btn-primary" href="/signup">${L.signup}</a></li>`}
</ul></nav></div></header>
<main id="main" tabindex="-1">${flash ? html`<div class="alert alert-${flash.kind}" role="${flash.kind === 'error' ? 'alert' : 'status'}">${flash.msg}</div>` : ''}${body}</main>
<footer><div class="in">${L.footer}</div></footer>
</body></html>`.__html;
}
