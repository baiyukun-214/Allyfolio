# Allyfolio

**Show your accessibility work, not just promise it** – scheduled accessibility scans and a timestamped evidence trail for EU websites.

> **项目简介（中文）**
> Allyfolio 是一款面向欧盟中小企业和网站代理商的无障碍监测 SaaS。它使用 axe-core 定期对网站进行自动化 WCAG 检测，持续跟踪问题，
> 保留带时间戳、不可篡改的证据历史，提供 0–100 的“自动化检测得分”（该得分不是符合性评级，也不代表法律评估），并生成 PDF 报告和无障碍声明草稿，帮助团队为《欧洲无障碍法案》（EAA）和德国 BFSG 做准备。
> 自动化检测大约只能发现 57% 的问题（Deque 研究），仍需人工审查；Allyfolio 不提供认证，也不证明法律层面的符合性；不使用覆盖层插件。
> 本仓库包含营销网站（`site/`，Astro）和控制台 + API（`app/`，Fastify），均支持英文和简体中文。

## What Allyfolio does

- **Automated WCAG checks** – real Chromium (Playwright) runs the open-source **axe-core** engine against your pages (WCAG 2.x A/AA rules).
- **Continuous monitoring** – weekly or daily site scans (sitemap + crawl, up to the plan's page limit), new/fixed issues diffed per scan, alerts on new serious issues.
- **Timestamped evidence history** – finished scans and issues are append-only and hash-chained (`evidence_hash`), so you can show what was tested, found and fixed, and when.
- **Reports and statement drafts** – HTML/PDF reports (white-label for agencies) and a draft accessibility statement for you to review and adapt.
- **Automated checks score (0–100)** – a weighted summary of the issues automated checks found per page. Automated testing catches only part of accessibility issues (about 57%, per Deque); this score is not a conformance rating or legal assessment.
- **Free single-page scan** on the marketing site; site ownership verification (DNS TXT or meta tag) before any monitoring.

## Who it's for

SMEs (online shops, service providers) and web agencies preparing for the **European Accessibility Act** (applies since 28 June 2025) and its German implementation, the **BFSG**. Microenterprises providing services may be exempt – Allyfolio says so honestly and is not legal advice.

## Plans (prices in EUR, excl. VAT; may change before launch)

| Plan | Price | Includes |
|---|---|---|
| Starter | €19 / month | 1 website, up to 100 pages, weekly scans, 12-month evidence history, 1 seat, audit trail, draft statement |
| Business | €39 / month | 3 websites, up to 500 pages per site, daily scans, 24-month history, PDF report export, 3 seats |
| Agency | €99 / month | 15 websites, up to 1,000 pages per site, daily scans, 24-month history, white-label reports, 10 seats |
| One-off report | €49 once | 1 website, up to 100 pages, a single scan and a PDF report, no subscription |

Billing runs through Paddle (Merchant of Record).

**Operator:** Xiamen Miaoerduo Trading Co., Ltd. (厦门妙尔多商贸有限公司), Room 907, No. 221 Jiahe Road, Siming District, Xiamen, Fujian, China · managing director Bai Yukun (白宇堃) · Unified Social Credit Code 91350203MAK7GQ50XC · hello@allyfolio.com (see the site imprint).

## Honest limits

- Automated testing finds only **roughly 57%** of accessibility issues ([Deque study](https://www.deque.com/automated-accessibility-testing-coverage/)). Meaningful alt text, focus order, understandable content and more need **manual review by people**.
- Allyfolio documents your work. It does **not** certify a site or prove legal conformity with the EAA/BFSG, and it is not legal advice.
- **No overlay widget** – nothing is injected into your site; fixes happen in your code.

## Repository layout

```
allyfolio-mono/
├─ site/   Astro marketing site (static, en + zh-CN) → Cloudflare Workers static assets (allyfolio.com),
│          built and deployed by Workers Builds on push to main          → site/README.md
└─ app/    Dashboard + API: Node 22, Fastify, SQLite (node:sqlite), Playwright + axe-core scanner, Paddle billing
           → Hetzner, Docker Compose + Caddy (app.allyfolio.com)          → app/README.md
```

Both packages are independent npm projects (own `package.json`, lockfile, README). Both original repositories were imported with full history (`git log --follow` works across the move).

## Tech stack

- **site/**: Astro 7, Tailwind CSS 4, Inter (self-hosted), small vanilla JS (progressive enhancement, `prefers-reduced-motion` respected), axe-core + Playwright accessibility checks. No tracking.
- **app/**: Node 22 + TypeScript (tsx), Fastify 5, server-rendered HTML, `node:sqlite` with a job queue and scheduler, Playwright Chromium + axe-core behind an SSRF guard and egress proxy, Paddle, Resend (EU) for email, optional Sentry-compatible error reporting.

## Quick start

Requires **Node 22.22** (see `site/.node-version`).

```bash
# marketing site – http://localhost:4321
cd site && npm ci && npm run dev
npm run build && npm run test:a11y      # static build + axe (en + zh, 1280 + 375)
npm run test:header                     # sticky header behaviour (Playwright)

# dashboard + API – http://localhost:8787
cd app && cp .env.example .env && npm ci && npm run dev
npm run typecheck && npm test && npm run test:e2e && npm run test:a11y
```

## Configuration

All app settings come from environment variables; see **`app/.env.example`** for the full list with comments (URLs, session secret, scanner limits, mailer, Paddle, Sentry, backups). Never commit `.env` files, databases, reports or backups.

## Deployment

- **Site** – Cloudflare Workers Builds: root directory `site`, build `npm ci && npm run build`, deploy `npx wrangler deploy`, `NODE_VERSION=22.22.0`. Every push to `main` deploys.
- **App** – Hetzner VM, `docker compose up -d --build` from `app/` (app, egress proxy, Caddy for TLS, scheduled backups). Details in `app/README.md`.

## Languages

English and Simplified Chinese (zh-CN) everywhere: the site under `/zh`, the dashboard, emails, reports and statement drafts.

## Copy rules (both packages, en + zh)

Never describe the product or its output as making a site meet legal requirements or as certifying it; always state that automated testing finds roughly 57% of issues (Deque) and that manual review is needed; no overlay widgets; mention the microenterprise exemption honestly.

## More

- [site/README.md](site/README.md) – marketing site
- [app/README.md](app/README.md) – dashboard, API, architecture, operations
