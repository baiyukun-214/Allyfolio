const e = process.env;
export const config = {
  port: Number(e.PORT ?? 8787),
  appUrl: (e.APP_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
  siteOrigins: (e.SITE_ORIGINS ?? 'http://localhost:4321').split(',').map((s) => s.trim()).filter(Boolean),
  dbPath: e.DATABASE_PATH ?? './data/allyfolio.db',
  sessionSecret: e.SESSION_SECRET ?? 'dev-insecure-secret',
  scanTimeoutMs: Number(e.SCAN_TIMEOUT_MS ?? 30000),
  scanConcurrency: Number(e.SCAN_CONCURRENCY ?? 2),
  freeScanPerHour: Number(e.FREE_SCAN_PER_IP_PER_HOUR ?? 5),
  allowPrivateTargets: e.ALLOW_PRIVATE_TARGETS === '1',
  mailer: e.MAILER ?? 'console',
  mailFrom: e.MAIL_FROM ?? 'Allyfolio <hello@allyfolio.com>',
  smtpUrl: e.SMTP_URL ?? '',
  stripe: {
    secretKey: e.STRIPE_SECRET_KEY ?? '',
    webhookSecret: e.STRIPE_WEBHOOK_SECRET ?? '',
    prices: { starter: e.STRIPE_PRICE_STARTER ?? '', business: e.STRIPE_PRICE_BUSINESS ?? '', agency: e.STRIPE_PRICE_AGENCY ?? '', oneoff: e.STRIPE_PRICE_ONEOFF ?? '' },
    earlyBirdCoupon: e.STRIPE_COUPON_EARLYBIRD ?? '',
  },
  workerEnabled: e.WORKER !== '0',
};
export const stripeConfigured = () => config.stripe.secretKey.startsWith('sk_test_') && config.stripe.secretKey.length > 12;
