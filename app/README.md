# Allyfolio app

Accessibility monitoring with a timestamped evidence trail for EU websites: free single-page scan, accounts and teams,
scheduled site scans, PDF reports, draft accessibility statements and Paddle billing (Merchant of Record).
Automated checks find only part of all issues (roughly 57%, Deque study) – the product says so everywhere. No overlay widget.

## Architecture

```
            allyfolio.com (Astro static site, ../site)                     app.allyfolio.com
                 │  /free-scan, waitlist → fetch /api/*                         │ dashboard (server-rendered HTML)
                 ▼                                                              ▼
 Caddy (TLS) ──► Fastify app (Node 22, TypeScript via tsx) ─────────────────────────────
                 ├─ routes/public.ts     POST /api/scan, POST /api/waitlist, GET /api/waitlist/confirm
                 ├─ routes/auth.ts       password (scrypt) + magic-link login, sessions, invites
                 ├─ routes/app.ts        sites CRUD, ownership verification (DNS TXT / meta tag), team + seats
                 ├─ routes/monitoring.ts scan history, scan detail + diff
                 ├─ routes/reports.ts    HTML/PDF report, white-label branding, statement generator
                 ├─ routes/billing.ts    checkout, plan changes, cancel, portal, webhook (/api/billing/webhook)
                 ├─ routes/account.ts    forgot/reset password, data export, account deletion
                 ├─ lib/billing/         provider interface (BILLING_PROVIDER): paddle.ts, creem.ts (stub)
                 ├─ lib/ssrf.ts          URL validation + DNS check for every request and redirect hop
                 ├─ lib/scanner.ts       Playwright Chromium + axe-core; all browser requests re-checked by the SSRF guard
                 ├─ egress/proxy.ts      egress proxy for Chromium: checks the resolved IP at connect time (separate service)
                 ├─ jobs/                SQLite-backed job queue, in-process worker + 60 s scheduler
                 └─ db.ts                node:sqlite (WAL); portable SQL schema
```

- **Database:** built-in `node:sqlite` (no native build). The schema uses portable SQL (TEXT ids, ISO timestamps) so it can move to Postgres; a Postgres adapter is **paused** (not written). Backups: see Deploy.
- **Evidence trail:** `scan_issues` cannot be updated and finished `scans` cannot be edited (SQLite triggers). Each scan stores `evidence_hash = sha256(prev_hash + scan content)`, so the history forms a hash chain. Retention deletes scans older than 12/24 months per plan.
- **Automated checks score:** `lib/insights.ts` – `100 / (1 + weighted issues per page / 10)` (critical 10, serious 5, moderate 2, minor 1), shown on the site page, scan detail and HTML/PDF report with the caption "Automated testing catches only part of accessibility issues (about 57%, per Deque). This score is not a conformance rating or legal assessment."
- **Queue:** `jobs` table, atomic claim (`UPDATE … RETURNING`), retries with backoff, stale-lock recovery. One app instance runs the worker (`WORKER=0` disables it).
- **SSRF protection:** only http/https on ports 80/443, no credentials, no `localhost`/`.local`/`.internal`, every resolved address must be public (IPv4 private/loopback/link-local/CGNAT/reserved, IPv6 loopback/ULA/link-local/multicast, IPv4-mapped, NAT64, 6to4). In the browser every request is intercepted, its host re-resolved and checked, and fetched with redirects disabled so each hop is re-checked. Service workers, downloads and non-page resource types are blocked. The PDF renderer has no network access (font and logo are inlined).
- **DNS rebinding:** server-side fetches (`safeFetch`: verification, sitemaps, logos) validate the address inside the socket's own DNS lookup, so the checked IP is the connected IP. Chromium is started with `SCAN_PROXY` (loopback included via `<-loopback>`, WebRTC limited to proxied traffic); the `egress` service resolves each CONNECT/HTTP request itself, rejects any non-public answer or port other than 80/443, and connects to the checked IP.
- **Plans** (`src/lib/plans.ts`): Starter €19 – 1 site, 100 pages, weekly, 12 months, PDF, 1 seat · Business €39 – 3 sites, 500 pages/site, daily, 24 months, PDF, 3 seats · Agency €99 – 15 sites, 1,000 pages/site, daily, 24 months, white-label, 10 seats · One-off €49 – 1 site, 100 pages, single scan, PDF.
- **Billing rules:** Paddle Billing is the Merchant of Record (it invoices and handles EU VAT). Monthly, cancel any time (at period end). Upgrades apply immediately (`proration_billing_mode: prorated_immediately`); downgrades update the Paddle subscription with `do_not_bill` and keep current limits until the period ends (scheduler applies `pending_plan`). Downgrades are refused until sites/seats fit. Checkout is a server-created Paddle transaction (price, discount and team decided server-side), opened with the Paddle.js overlay or, without JS, its hosted checkout URL. Webhooks are verified (`Paddle-Signature`, HMAC-SHA256, 5-min tolerance) and processed idempotently (`billing_events`). Early-bird: confirmed waitlist members within the first 100 get the 30%-off-12-months discount automatically.
- **Accounts:** password reset tokens are random, stored hashed, valid 60 minutes, single use; a reset signs the user out everywhere and sends a notice. Data export (`/app/account/export`, JSON) and self-service deletion (owned teams pass to the longest-standing member, solo teams are deleted after their subscription is canceled immediately).

## Environment variables

See `.env.example` (placeholders only; all secrets come from the environment). Required in production: `PUBLIC_APP_URL` (e.g. `https://app.allyfolio.com`; `APP_URL` is still accepted), `SITE_URL` (`https://allyfolio.com`), `SITE_ORIGINS`, `COOKIE_DOMAIN` (`.allyfolio.com`), `SESSION_SECRET` (32+ random bytes), `RESEND_API_KEY`, the `PADDLE_*` values. Optional: `SENTRY_DSN`, `BACKUP_*`. `ALLOW_PRIVATE_TARGETS` must stay `0` outside tests.

## Run locally

```bash
export PATH=~/node22/bin:$PATH
npm install
npx playwright install chromium        # once
cp .env.example .env                    # optional; defaults work for dev
npm run dev                             # http://localhost:8787 – sign up at /signup
npm run set-plan -- you@example.com business 1   # dev: give your team a plan (+1 one-off credit) without Paddle
```

Mail is printed to the console in dev (magic links, waitlist confirmations, invites, alerts).
Note: in dev the SSRF guard blocks localhost targets; to scan a local test site run with `ALLOW_PRIVATE_TARGETS=1` (never in production).

Marketing site against the local API:

```bash
cd ../site && npm run build && npm run preview   # dev builds of the site default to http://localhost:8787;   # SITE_ORIGINS must include http://localhost:4321
```

## Tests

```bash
npm test            # unit: SSRF guard, egress proxy (private IPs, loopback names, rebinding), plan limits, billing, Paddle signatures, mailer, monitoring
npm run test:e2e    # e2e: free scan of a local fixture page, waitlist opt-in, accounts/teams/sites, crawler + scheduled scans + diff + alerts + immutability + retention, reports/PDF/white-label/statement, Paddle checkout/webhooks/plan changes (fake Paddle API), password reset, export, deletion, en/zh
npm run test:a11y   # axe-core on all dashboard pages at 1280px and 375px (fails on serious/critical)
npm run typecheck
```

## Billing: Paddle (sandbox first)

Env names: `PADDLE_ENV` (`sandbox`|`production`), `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN` (client-side token for Paddle.js), plus the IDs written by the setup script.

1. In the Paddle **sandbox** dashboard create an API key (permissions: products, prices, discounts, customers, subscriptions, transactions, customer portal sessions, notification settings) and a client-side token. Put `PADDLE_ENV=sandbox`, `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN` into `.env`.
2. `npm run paddle:setup` – **idempotent**: finds or creates (tagged with `custom_data.allyfolio_key`) the products, monthly EUR prices Starter €19 / Business €39 / Agency €99, the one-off report price €49, and the early-bird discount (30%, recurring for 12 billing periods, max 100 redemptions, subscription prices only, not enterable as a code). A price whose amount changed is archived and replaced. The IDs are written into `.env` (`PADDLE_PRICE_*`, `PADDLE_DISCOUNT_EARLYBIRD`); existing lines are updated in place. Only IDs are printed – never keys or secrets. Safe to run again any time.
3. Paddle → Checkout settings: set the default payment link to `<PUBLIC_APP_URL>/app/billing` and approve your domain (sandbox accepts `localhost`).
4. Webhooks:
   - **Local, no tunnel:** nothing to do. After the overlay checkout, Paddle.js returns to `<PUBLIC_APP_URL>/app/billing?paid=1&txn=<transaction id>`. The page (and its status poll, `/app/billing/status?txn=…`) reads that transaction and its subscription from the Paddle API, checks it belongs to the user's team (owner only) and applies it. Repeating it is harmless and it is idempotent with the webhook (subscription state is set absolutely; one-off credits are counted once per transaction). Renewals, cancellations in the Paddle portal and failed payments still need the webhook.
   - **Local with webhooks:** `cloudflared tunnel --url http://localhost:8787` prints `https://<name>.trycloudflare.com`; run `PADDLE_WEBHOOK_URL=https://<name>.trycloudflare.com/api/billing/webhook npm run paddle:setup`. This creates (or reuses) the notification destination with the required events and writes `PADDLE_WEBHOOK_SECRET` into `.env` (hidden in the output). Quick tunnels get a new name on each start – re-run the command (a new destination is created for the new URL; delete old ones in the dashboard). Use Paddle's webhook simulator to send test events.
   - **Production:** `PADDLE_WEBHOOK_URL=https://app.allyfolio.com/api/billing/webhook npm run paddle:setup -- --production` with `PADDLE_ENV=production` keys.
5. Going live: Paddle reviews the business and website (published Terms, Privacy, refund policy and pricing), then repeat steps 1–4 with production keys.

Events used: `subscription.created|updated|activated|past_due|paused|resumed|canceled`, `transaction.completed`, `transaction.payment_failed`. Webhooks are verified with `PADDLE_WEBHOOK_SECRET`; without it the webhook endpoint rejects every call. After checkout, Paddle.js returns to `<PUBLIC_APP_URL>/app/billing?paid=1&txn=<id>` (absolute URL from `PUBLIC_APP_URL`, e.g. `https://app.allyfolio.com`; `APP_URL` is accepted as an alias); that page polls `/app/billing/status?txn=<id>` (which runs the return-URL sync) every 2 s for up to 30 s with an `aria-live` "processing" message and reloads once the plan or one-off credit is active.

`BILLING_PROVIDER=creem` selects a stub that reports "not configured"; `none` disables billing.

## Mail: Resend (outbound) and Cloudflare Email Routing (inbound)

- Outbound: add `allyfolio.com` in Resend with region **eu-west-1 (Ireland)** – the region is chosen per domain; the API endpoint (`api.resend.com`) is global. Add the SPF/DKIM/(return-path) records Resend shows. These live on a subdomain (e.g. `send.allyfolio.com`) and do **not** touch the root MX. Mail is sent from `hello@allyfolio.com` (`MAIL_FROM`).
- Inbound: `hello@allyfolio.com` is received with **Cloudflare Email Routing** (forward to a personal mailbox). Cloudflare manages the root MX for that; do not change the root MX by hand and do not point it at Resend.
- Dev: `MAILER=console` prints every mail (magic links, resets, invites, alerts).

## Deploy (Hetzner Cloud CPX31, Docker Compose + Caddy)

Step-by-step commands: see [DEPLOY.md](DEPLOY.md).

1. Create a **CPX31** (4 vCPU / 8 GB) in Falkenstein, Nuremberg or Helsinki with Ubuntu 24.04; firewall: 22 (your IP), 80, 443 only. Install Docker Engine + compose plugin.
2. DNS (Cloudflare, "DNS only"/grey cloud so Caddy's automatic HTTPS works): `allyfolio.com`, `www`, `app` → server IPv4/IPv6. Keep the Email Routing MX records as they are.
3. Clone the monorepo to `/srv/allyfolio-mono`. The site is normally deployed to Cloudflare Workers (see `site/README.md`); to serve it from this server instead, build it with `cd site && npm ci && PUBLIC_API_BASE= npm run build` (empty = same origin) – Caddy mounts `../site/dist`.
4. In `allyfolio-app`: `cp .env.example .env` and set at least:
   ```
   PUBLIC_APP_URL=https://app.allyfolio.com
   SITE_URL=https://allyfolio.com
   SITE_ORIGINS=https://allyfolio.com,https://www.allyfolio.com
   COOKIE_DOMAIN=.allyfolio.com
   SESSION_SECRET=$(openssl rand -base64 32)
   RESEND_API_KEY=…   PADDLE_*=…   (SENTRY_DSN=… optional)
   ```
   Adjust domains in `deploy/Caddyfile`.
5. `docker compose up -d --build`. Services: `app` (dashboard/API + worker), `egress` (scanner proxy, internal only), `backup`, `caddy` (TLS + static site). Check `docker compose ps` and `curl https://app.allyfolio.com/api/health`.
6. Do not publish the app port directly: rate limiting trusts `X-Forwarded-For` from Caddy.
7. Updates: `git pull && docker compose up -d --build` (schema migrations run at start). Take a backup first: `docker compose exec backup /deploy/backup.sh`.

### Backups

The `backup` service runs `deploy/backup.sh` daily at `BACKUP_TIME` (UTC): `sqlite3 .backup` (online, WAL-safe) → `PRAGMA integrity_check` → gzip into `./backups/`, keeping the newest `BACKUP_KEEP_DAILY` (default 14). Optional offsite copy: put an `rclone.conf` (e.g. Hetzner Storage Box via SFTP, or any S3 bucket in the EU) in `deploy/rclone/` and set `BACKUP_RCLONE_REMOTE`; remote copies older than `BACKUP_REMOTE_KEEP_DAYS` are deleted. Restore: stop `app`, `gunzip -c backups/allyfolio-….db.gz > allyfolio.db`, copy it into the `appdata` volume as `/data/allyfolio.db` (remove stale `-wal`/`-shm`), start `app`. Also enable Hetzner server snapshots/backups as a second layer.

### Error monitoring (optional)

Set `SENTRY_DSN` to a Sentry or self-hosted GlitchTip DSN. Unhandled 5xx errors and unhandled rejections are sent via the envelope API (`src/lib/monitoring.ts`, no SDK); URLs are scrubbed of tokens and no request bodies, cookies or emails are sent. Empty DSN = off.

## Known gaps / next steps

- Paused: Postgres adapter, multi-instance rate limiter/queue (single app instance assumed: in-memory rate limiter, in-process worker), team switcher for users in several teams.
- Creem provider is a stub.
- Statement generator produces a draft only; it must be reviewed by the site owner.

## Languages (en, zh-CN)

All UI, emails, HTML/PDF reports and the statement draft come from `src/i18n.ts` (`t(locale)`).
Locale priority: the user's setting (`/app/settings`, stored in `users.locale`) > `?lang=` (persisted to the `af_lang` cookie) > cookie > `Accept-Language` > English.
The header switcher links to `/lang?to=…&next=…`, which sets the cookie (and the user's setting when logged in).
`POST /api/scan` and `POST /api/waitlist` accept `lang`; scan results carry a localised `label` per impact group and Chinese rule help from axe-core's own `zh_CN` locale (English fallback for unmapped rules).
PDF reports need a CJK font on the server; the Docker image installs `fonts-noto-cjk`.
