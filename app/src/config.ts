import { existsSync } from 'node:fs';
// Load .env (or ENV_FILE) for local runs. Real environment variables win; skipped under the test runner.
{ const f = process.env.ENV_FILE ?? '.env'; if (!process.env.NODE_TEST_CONTEXT && existsSync(f)) process.loadEnvFile(f); }
const e = process.env;
export const config = {
  port: Number(e.PORT ?? 8787),
  appUrl: (e.PUBLIC_APP_URL ?? e.APP_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
  siteOrigins: (e.SITE_ORIGINS ?? 'http://localhost:4321').split(',').map((s) => s.trim()).filter(Boolean),
  /** Marketing site (links from the dashboard back to it). */
  siteUrl: (e.SITE_URL ?? 'http://localhost:4321').replace(/\/$/, ''),
  /** Optional shared cookie domain (e.g. .allyfolio.com) for the af_logged_in hint cookie read by the marketing site. */
  cookieDomain: e.COOKIE_DOMAIN || undefined,
  dbPath: e.DATABASE_PATH ?? './data/allyfolio.db',
  sessionSecret: e.SESSION_SECRET ?? 'dev-insecure-secret',
  scanTimeoutMs: Number(e.SCAN_TIMEOUT_MS ?? 30000),
  scanConcurrency: Number(e.SCAN_CONCURRENCY ?? 2),
  freeScanPerHour: Number(e.FREE_SCAN_PER_IP_PER_HOUR ?? 5),
  allowPrivateTargets: e.ALLOW_PRIVATE_TARGETS === '1',
  mailer: e.MAILER ?? (e.RESEND_API_KEY ? 'resend' : 'console'),
  mailFrom: e.MAIL_FROM ?? 'Allyfolio <hello@allyfolio.com>',
  billing: {
    provider: (e.BILLING_PROVIDER ?? 'paddle') as 'paddle' | 'creem' | 'none',
    paddle: {
      env: (e.PADDLE_ENV === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production',
      apiKey: e.PADDLE_API_KEY ?? '',
      apiBase: e.PADDLE_API_BASE ?? '', // override for tests; default derived from PADDLE_ENV
      webhookSecret: e.PADDLE_WEBHOOK_SECRET ?? '',
      clientToken: e.PADDLE_CLIENT_TOKEN ?? '',
      prices: { starter: e.PADDLE_PRICE_STARTER ?? '', business: e.PADDLE_PRICE_BUSINESS ?? '', agency: e.PADDLE_PRICE_AGENCY ?? '', oneoff: e.PADDLE_PRICE_ONEOFF ?? '' },
      earlyBirdDiscount: e.PADDLE_DISCOUNT_EARLYBIRD ?? '',
    },
    creem: { apiKey: e.CREEM_API_KEY ?? '', webhookSecret: e.CREEM_WEBHOOK_SECRET ?? '' },
  },
  resendApiKey: e.RESEND_API_KEY ?? '',
  resendApiUrl: (e.RESEND_API_URL ?? 'https://api.resend.com').replace(/\/$/, ''),
  sentryDsn: e.SENTRY_DSN ?? '',
  scanProxy: e.SCAN_PROXY ?? '', // e.g. http://egress:3128 – the egress proxy that blocks private ranges at connect time
  workerEnabled: e.WORKER !== '0',
};
