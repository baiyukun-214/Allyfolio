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

## Deploy to Cloudflare Pages
- Framework preset: Astro (or None)
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable: `NODE_VERSION=22.22.0` (or rely on `.nvmrc`)

Pages are built as `page.html`, which Cloudflare Pages serves at clean URLs (`/pricing`).

## Copy rules
Never claim the product makes sites "compliant", "certified" or guarantees anything. Always mention that automated testing finds roughly 57% of issues (Deque) and that manual review is needed. No overlay widgets. Mention the microenterprise exemption honestly.

## Open TODOs
Search for `TODO` in `src/`: plan limits, waitlist API, free scan API, imprint legal details, privacy policy review, hosting region.
