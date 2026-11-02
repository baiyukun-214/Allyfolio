import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://allyfolio.com',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' }, // clean URLs: /pricing -> pricing.html (Cloudflare Pages serves without .html)
  integrations: [sitemap({
    // EN + DE only: /zh pages stay online but are noindex and unlisted.
    filter: (page) => !/\/(404|waitlist-check-email|waitlist-error)\/?$/.test(page) && !/^https:\/\/allyfolio\.com\/zh(\/|$)/.test(page),
    i18n: { defaultLocale: 'en', locales: { en: 'en', de: 'de' } },
    // x-default → English, on every EN/DE pair.
    serialize: (item) => {
      if (item.links?.length > 1) {
        const en = item.links.find((x) => x.lang === 'en');
        if (en && !item.links.some((x) => x.lang === 'x-default')) item.links = [...item.links, { lang: 'x-default', url: en.url }];
      } else delete item.links;
      return item;
    },
  })],
  vite: { plugins: [tailwindcss()] },
});
