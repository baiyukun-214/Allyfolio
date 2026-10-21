import { html, type Html } from '../lib/html.ts';
const logo = html`<svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="16" fill="#1e3a8a"/><path d="M19 47 32 17l13 30" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M24.5 37h15" stroke="#a5b4fc" stroke-width="6" stroke-linecap="round"/></svg>`;
export interface PageOpts { title: string; body: Html; user?: { email: string } | null; current?: string; flash?: { kind: 'ok' | 'error'; msg: string } | null }
export function page({ title, body, user, current, flash }: PageOpts): string {
  const links = user ? [['/app', 'Sites'], ['/app/team', 'Team'], ['/app/billing', 'Billing']] : [];
  return '<!doctype html>' + html`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Allyfolio</title><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/app.css"></head>
<body><a class="skip" href="#main">Skip to main content</a>
<header class="top"><div class="in"><a class="brand" href="${user ? '/app' : '/'}">${logo}<span>Allyfolio</span></a>
<nav class="main" aria-label="Main"><ul>${links.map(([h, l]) => html`<li><a href="${h}" ${current === h ? html`aria-current="page"` : ''}>${l}</a></li>`)}
${user ? html`<li><form method="post" action="/logout"><button class="btn btn-secondary" type="submit">Log out<span class="sr-only"> ${user.email}</span></button></form></li>` : html`<li><a href="/login">Log in</a></li><li><a class="btn btn-primary" href="/signup">Create account</a></li>`}
</ul></nav></div></header>
<main id="main" tabindex="-1">${flash ? html`<div class="alert alert-${flash.kind}" role="${flash.kind === 'error' ? 'alert' : 'status'}">${flash.msg}</div>` : ''}${body}</main>
<footer><div class="in">Allyfolio is a testing and documentation tool, not legal advice. Automated checks find only part of all accessibility issues.</div></footer>
</body></html>`.__html;
}
