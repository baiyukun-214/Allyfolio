# Allyfolio marketing site

Static marketing site for [allyfolio.com](https://allyfolio.com), built with Astro 7 + Tailwind CSS v4 (via `@tailwindcss/vite`) and `@astrojs/sitemap`.

## Requirements
Node.js **22.22.0 or newer** (see `.nvmrc`; Astro 7 requires it).

## Run
```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # outputs static site to dist/
npm run preview    # serve dist/ locally
npm run test:a11y  # axe-core check of every page (desktop + mobile); run after build
```
`test:a11y` needs a Playwright browser once: `npx playwright install chromium`.

## Add a blog post
Create `src/content/blog/<slug>.md` with frontmatter:
```md
---
title: "Post title"
description: "Meta description (~150 chars)"
pubDate: 2026-11-01
draft: false
---
```
It appears at `/blog/<slug>` and on `/blog` automatically. Use `##` headings and below (the title is the page's only h1).

## Deploy to Cloudflare Workers (static assets)
`wrangler.jsonc` deploys `./dist` as a static-assets-only Worker named `allyfolio` (no Worker script). Unknown paths get `dist/404.html` (`not_found_handling: "404-page"`); `page.html` is served at clean URLs (`/pricing`).

Workers Builds (Cloudflare dashboard → Workers → allyfolio → Settings → Build), repo = the monorepo:
- Root directory: `site`
- Build command: `npm ci && npm run build`
- Deploy command: `npx wrangler deploy`
- Build variables: `NODE_VERSION=22.22.0` (also pinned in `.node-version`; Astro needs Node ≥ 22.22), optionally `PUBLIC_APP_LIVE` / `PUBLIC_APP_URL` / `PUBLIC_API_BASE`.

URLs: production builds default to `https://app.allyfolio.com` for both the dashboard links (`PUBLIC_APP_URL`) and the API (`PUBLIC_API_BASE`); `astro dev` defaults to `http://localhost:8787`. Set either variable to override; an explicitly empty `PUBLIC_API_BASE` means same origin. The app must allow the site in CORS: `SITE_ORIGINS=https://allyfolio.com,https://www.allyfolio.com`.

**Pre-launch flag (`PUBLIC_APP_LIVE`):** until the dashboard at `app.allyfolio.com` is live, the site renders **no** Log in / Sign up / Dashboard links (header, mobile menu, footer); every CTA points to the waitlist (`/#waitlist`) or the free scan (`/free-scan`). At launch set the build variable `PUBLIC_APP_LIVE=true` (together with `PUBLIC_APP_URL` if it differs from the default) and redeploy – the links come back, including the `af_logged_in` cookie switch to “Dashboard”. Any other value or no value keeps them hidden. The flag lives in `src/lib/api.ts` (`APP_LIVE`).

**Indexing:** `/waitlist-check-email` and `/waitlist-error` (en + zh) carry `<meta name="robots" content="noindex, follow">` and are excluded from the sitemap (`astro.config.mjs`). Pass `noindex` to `Base.astro` for any other utility page.

**Resources (SEO content):** cornerstone guides live in `src/i18n/resources.ts` (en + zh HTML, rendered by `src/views/Resource.astro`) at `/eaa`, `/bfsg`, `/microenterprise-exemption`, `/who-is-affected`, `/en-301-549-wcag`, with a hub at `/resources`; `/features` is a real page (`src/views/Features.astro`). Each guide shows a “not legal advice” note, links to the free scan and pricing, related guides and the official sources (EUR-Lex, gesetze-im-internet.de, ETSI, W3C, Deque). Facts were checked against those sources in October 2026 – re-check them when EN 301 549 V4.1.1 is cited in the Official Journal. Remember that the EAA (Directive (EU) 2019/882) is not the Web Accessibility Directive (EU) 2016/2102 (public sector).

Custom domains (`allyfolio.com`, `www`) are attached in the dashboard. `wrangler.jsonc` deliberately declares no `routes`/custom domains, so `wrangler deploy` does not change them.

## Copy rules
Never claim the product makes sites "compliant", "certified" or guarantees anything. Always mention that automated testing finds roughly 57% of issues (Deque) and that manual review is needed. No overlay widgets. Mention the microenterprise exemption honestly.

## Open TODOs
Search for `TODO` in `src/`: plan limits, waitlist API, free scan API, imprint legal details, privacy policy review, hosting region.
