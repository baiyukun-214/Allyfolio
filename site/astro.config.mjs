import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://allyfolio.com',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' }, // clean URLs: /pricing -> pricing.html (Cloudflare Pages serves without .html)
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] },
});
