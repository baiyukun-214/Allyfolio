#!/usr/bin/env node
// After `astro build` without PUBLIC_APP_LIVE: header/footer Log in and Sign up must be present
// in English and German, while paid plan buttons must still go to the waitlist.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'dist');
const files = {
  enHome: 'index.html',
  enPricing: 'pricing.html',
  deHome: 'de.html',
  dePricing: 'de/pricing.html',
};
const fail = (msg) => { console.error(msg); process.exit(1); };
for (const [label, rel] of Object.entries(files)) {
  const p = resolve(root, rel);
  if (!existsSync(p)) fail(`missing ${label} (${rel}) — run astro build first`);
  const html = readFileSync(p, 'utf8');
  const lang = label.startsWith('de') ? 'de' : 'en';
  if (!html.includes(`/login?lang=${lang}`)) fail(`${label}: missing Log in link for lang=${lang}`);
  if (!html.includes(`/signup?lang=${lang}`)) fail(`${label}: missing Sign up link for lang=${lang}`);
  if (label.endsWith('Pricing')) {
    if (!html.includes('/#waitlist') && !html.includes('/de#waitlist')) fail(`${label}: plan buttons should still point at the waitlist`);
    if (/\/signup\?[^"]*plan=/.test(html)) fail(`${label}: plan buttons must not open signup checkout carry`);
  }
}
console.log('auth-cta-check: EN/DE login and signup present; pricing CTAs stay on the waitlist');
