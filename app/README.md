# Allyfolio app

Accessibility monitoring with a timestamped evidence trail for EU websites: free single-page scan, accounts and teams,
scheduled site scans, PDF reports, draft accessibility statements and Stripe billing.
Automated checks find only part of all issues (roughly 57%, Deque study) – the product says so everywhere. No overlay widget.

## Architecture

```
            allyfolio.com (Astro static site, ../allyfolio-site)          app.allyfolio.com
                 │  /free-scan, waitlist → fetch /api/*                         │ dashboard (server-rendered HTML)
                 ▼                                                              ▼
 Caddy (TLS) ──► Fastify app (Node 22, TypeScript via tsx) ─────────────────────────────
                 ├─ routes/public.ts     POST /api/scan, POST /api/waitlist, GET /api/waitlist/confirm
                 ├─ routes/auth.ts       password (scrypt) + magic-link login, sessions, invites
                 ├─ routes/app.ts        sites CRUD, ownership verification (DNS TXT / meta tag), team + seats
                 ├─ routes/monitoring.ts scan history, scan detail + diff
                 ├─ routes/reports.ts    HTML/PDF report, white-label branding, statement generator
                 ├─ routes/billing.ts    Stripe Checkout, portal, plan changes, webhook (/api/stripe/webhook)
                 ├─ lib/ssrf.ts          URL validation + DNS check for every request and redirect hop
                 ├─ lib/scanner.ts       Playwright Chromium + axe-core; all browser requests re-checked by the SSRF guard
                 ├─ jobs/                SQLite-backed job queue, in-process worker + 60 s scheduler
                 └─ db.ts                node:sqlite (WAL); portable SQL schema
```

- **Database:** built-in `node:sqlite` (no native build). The schema uses portable SQL (TEXT ids, ISO timestamps) so it can move to Postgres; a Postgres adapter is **not** written yet.
- **Evidence trail:** `scan_issues` cannot be updated and finished `scans` cannot be edited (SQLite triggers). Each scan stores `evidence_hash = sha256(prev_hash + scan content)`, so the history forms a hash chain. Retention deletes scans older than 12/24 months per plan.
- **Queue:** `jobs` table, atomic claim (`UPDATE … RETURNING`), retries with backoff, stale-lock recovery. One app instance runs the worker (`WORKER=0` disables it).
- **SSRF protection:** only http/https on ports 80/443, no credentials, no `localhost`/`.local`/`.internal`, every resolved address must be public (IPv4 private/loopback/link-local/CGNAT/reserved, IPv6 loopback/ULA/link-local/multicast, IPv4-mapped, NAT64, 6to4). In the browser every request is intercepted, its host re-resolved and checked, and fetched with redirects disabled so each hop is re-checked. Service workers, downloads and non-page resource types are blocked. The PDF renderer has no network access (font and logo are inlined).
- **Plans** (`src/lib/plans.ts`): Starter €19 – 1 site, 100 pages, weekly, 12 months, 1 seat · Business €39 – 3 sites, 500 pages/site, daily, 24 months, PDF, 3 seats · Agency €99 – 15 sites, 1,000 pages/site, daily, 24 months, white-label, 10 seats · One-off €39 – 1 site, 100 pages, single scan, PDF.
- **Billing rules:** monthly, cancel any time. Upgrades apply immediately with a prorated invoice (`proration_behavior: always_invoice`); downgrades switch the Stripe price with no proration and keep the current limits until the period ends (scheduler applies them). Downgrades are refused until sites/seats fit the target plan. Early-bird: confirmed waitlist members within the first 100 get the 30%-off-12-months coupon automatically at checkout.

## Environment variables

See `.env.example`. Required in production: `APP_URL`, `SITE_ORIGINS`, `SESSION_SECRET` (32+ random bytes), `MAIL_FROM` + a real mailer, Stripe test keys and price IDs. `ALLOW_PRIVATE_TARGETS` must stay `0` outside tests.

## Run locally

```bash
export PATH=~/node22/bin:$PATH
npm install
npx playwright install chromium        # once
cp .env.example .env                    # optional; defaults work for dev
npm run dev                             # http://localhost:8787 – sign up at /signup
npm run set-plan -- you@example.com business 1   # dev: give your team a plan (+1 one-off credit) without Stripe
```

Mail is printed to the console in dev (magic links, waitlist confirmations, invites, alerts).
Note: in dev the SSRF guard blocks localhost targets; to scan a local test site run with `ALLOW_PRIVATE_TARGETS=1` (never in production).

Marketing site against the local API:

```bash
cd ../allyfolio-site && PUBLIC_API_BASE=http://localhost:8787 npm run build && npm run preview   # SITE_ORIGINS must include http://localhost:4321
```

## Tests

```bash
npm test            # unit: SSRF guard, plan limits, billing proration
npm run test:e2e    # e2e: free scan of a local fixture page, waitlist opt-in, accounts/teams/sites, crawler + scheduled scans + diff + alerts + immutability + retention, reports/PDF/white-label/statement, Stripe webhooks
npm run test:a11y   # axe-core on all dashboard pages at 1280px and 375px (fails on serious/critical)
npm run typecheck
```

## Stripe (test mode)

1. Create a Stripe account, stay in **test mode**, copy the `sk_test_…` key.
2. `STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup` – creates products, EUR monthly prices, the one-off price and the early-bird coupon; paste the printed lines into `.env`.
3. Add a webhook endpoint `https://app.allyfolio.com/api/stripe/webhook` (events: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed`), put its secret into `STRIPE_WEBHOOK_SECRET`. Locally: `stripe listen --forward-to localhost:8787/api/stripe/webhook`.
4. Configure the Customer Portal (invoices, payment method, cancellation; plan switching optional).

## Deploy (EU server, e.g. Hetzner Germany)

1. Create a server (e.g. CPX31, 4 vCPU / 8 GB, Falkenstein or Nuremberg), install Docker + compose plugin, open ports 80/443 only.
2. Point DNS: `allyfolio.com`, `www`, `app` → server IP.
3. Copy both repos to the server side by side; build the site: `cd allyfolio-site && npm ci && npm run build` (leave `PUBLIC_API_BASE` empty – same origin).
4. In `allyfolio-app`: create `.env` (`APP_URL=https://app.allyfolio.com`, `SITE_ORIGINS=https://allyfolio.com,https://www.allyfolio.com`, secrets), adjust `deploy/Caddyfile` domains.
5. `docker compose up -d --build`. Caddy gets TLS certificates automatically. Data lives in the `appdata` volume – back it up (e.g. nightly `sqlite3 .backup` to Hetzner Storage Box).
6. Do not publish the app port directly: rate limiting trusts `X-Forwarded-For` from Caddy.

## Known gaps / next steps

- Mailer: only the console mailer exists; add a provider (`src/lib/mailer.ts`, e.g. Postmark EU, Brevo, AWS SES eu-central-1) and SPF/DKIM.
- Postgres adapter not written (schema is portable). Single app instance assumed (in-memory rate limiter, in-process worker).
- DNS rebinding: hosts are re-resolved per request, but there is a small window between check and connect; for stronger isolation run the scanner in a separate network namespace/egress proxy that blocks private ranges.
- No password reset page (magic link covers it), no account deletion UI, no team switching for users in several teams.
- Statement generator produces a draft only; it must be reviewed by the site owner.
