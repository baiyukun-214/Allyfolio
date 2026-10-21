# Allyfolio monorepo

Accessibility monitoring with a timestamped evidence trail for EU websites.

```
allyfolio-mono/
├─ site/   Marketing site (Astro, static, en + zh-CN) → Cloudflare Workers static assets (allyfolio.com, www)
│          see site/README.md
└─ app/    Dashboard + API (Fastify, Node 22, SQLite, Playwright scanner, Paddle billing) → Hetzner, Docker Compose + Caddy
           (app.allyfolio.com); see app/README.md
```

Both packages are independent npm projects (own `package.json`, lockfile, `.env.example`, README). Install and run them
from their folder:

```bash
cd site && npm ci && npm run dev          # http://localhost:4321  (API/dashboard default: http://localhost:8787)
cd app  && npm ci && npm run dev          # http://localhost:8787
```

History: both original repositories were imported with their full history (rewritten into `site/` and `app/` with
`git filter-repo --to-subdirectory-filter`, then merged). `git log --follow app/src/server.ts` works across the move.

## Deploy

- **Site** – Cloudflare Workers Builds, root directory `site`, build `npm ci && npm run build`, deploy `npx wrangler deploy`,
  `NODE_VERSION=22.22.0`. Details in `site/README.md`.
- **App** – Hetzner CPX31 with `docker compose up -d --build` from `app/`. `app/docker-compose.yml` can also serve the built
  site from `../site/dist` via Caddy; with the site on Cloudflare only `app.allyfolio.com` is
  needed in `app/deploy/Caddyfile`. Details in `app/README.md`.

## Secrets

Never commit `.env` files, databases, reports/PDFs or backups (see `.gitignore`). Secrets come from the environment only;
placeholders live in each package's `.env.example`.

## Copy rules (both packages, en + zh)

Never describe the product or its output as making a site meet legal requirements; always state that automated testing
finds roughly 57% of issues (Deque) and that manual review is needed; no overlay widgets; mention the microenterprise
exemption honestly.
