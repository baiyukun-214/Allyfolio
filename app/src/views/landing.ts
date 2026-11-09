import { html } from '../lib/html.ts';
import { t, type Locale } from '../i18n.ts';
import { siteLink } from './layout.ts';

/** Public product page for logged-out visitors at `/`. Copy must stay within the project wording rules (no over-claim words; DE/ZH equivalents likewise). */
export function landingBody(locale: Locale = 'en') {
  const L = t(locale).landing;
  const Lay = t(locale).layout;
  const price = (name: string, amount: string) => html`<li class="landing-plan"><span class="landing-plan-name">${name}</span><span class="landing-plan-price">${amount}</span></li>`;
  return html`
  <section class="landing-hero" aria-labelledby="landing-h1">
    <p class="eyebrow">${L.eyebrow}</p>
    <h1 id="landing-h1">${L.h1}</h1>
    <p class="lead">${L.lead}</p>
    <p class="notice">${L.note}</p>
    <p class="landing-cta">
      <a class="btn btn-primary" href="/signup">${L.signup}</a>
      <a class="btn btn-secondary" href="/login">${L.login}</a>
    </p>
  </section>
  <section class="landing-plans card" aria-labelledby="landing-plans-h">
    <h2 id="landing-plans-h">${L.plansH}</h2>
    <ul class="landing-plan-list">
      ${price(L.starter, L.starterPrice)}
      ${price(L.business, L.businessPrice)}
      ${price(L.agency, L.agencyPrice)}
      ${price(L.oneoff, L.oneoffPrice)}
    </ul>
    <p class="small muted">${L.pricesNote}</p>
    <p><a href="${siteLink(locale, '/pricing')}">${L.pricingLink}</a></p>
    <p class="notice small"><strong>${L.refund}</strong></p>
  </section>
  <section class="landing-about card" aria-labelledby="landing-about-h">
    <h2 id="landing-about-h">${L.title}</h2>
    <p>${L.company}</p>
    <p>${L.contact}: <a href="mailto:hello@allyfolio.com">${L.contactEmail}</a></p>
    <h3 class="landing-legal-h">${L.legalH}</h3>
    <ul class="footlinks landing-legal">
      <li><a href="${siteLink(locale, '/terms')}">${Lay.terms}</a></li>
      <li><a href="${siteLink(locale, '/privacy')}">${Lay.privacy}</a></li>
      <li><a href="${siteLink(locale, '/refund')}">${Lay.refund}</a></li>
      <li><a href="${siteLink(locale, '/imprint')}">${Lay.imprint}</a></li>
    </ul>
  </section>`;
}
