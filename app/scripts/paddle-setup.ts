// Idempotent Paddle setup: finds or creates products, monthly EUR prices (19/39/99), the €49 one-off price, the early-bird
// discount (30%, first 12 billing periods, max 100 uses) and – if PADDLE_WEBHOOK_URL is a public https URL – the notification
// destination. Writes the IDs (and the webhook secret) into .env. Prints IDs only, never secrets.
// Usage: npm run paddle:setup            (reads .env: PADDLE_ENV=sandbox, PADDLE_API_KEY)
//        PADDLE_WEBHOOK_URL=https://<tunnel>/api/billing/webhook npm run paddle:setup
//        npm run paddle:setup -- --production   (only with PADDLE_ENV=production)
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runPaddleSetup } from '../src/lib/billing/paddleSetup.ts';
const envPath = resolve(process.env.ENV_FILE ?? '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
let env = process.env.PADDLE_ENV ?? 'sandbox';
const key = process.env.PADDLE_API_KEY ?? '';
if (!key) { console.error(`PADDLE_API_KEY is not set (looked in ${envPath} and the environment).`); process.exit(1); }
if (env === 'live') env = 'production';
if (env === 'production' && !process.argv.includes('--production')) { console.error('PADDLE_ENV=production: re-run with -- --production to confirm.'); process.exit(1); }
if (env !== 'production' && env !== 'sandbox') { console.error('PADDLE_ENV must be sandbox or live.'); process.exit(1); }
const apiBase = process.env.PADDLE_API_BASE || (env === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');
console.log(`Paddle ${env} setup → ${envPath}`);
try {
  await runPaddleSetup({ apiKey: key, apiBase, webhookUrl: process.env.PADDLE_WEBHOOK_URL || undefined, envPath });
  if (!process.env.PADDLE_CLIENT_TOKEN) console.log('Note: PADDLE_CLIENT_TOKEN is not set – create a client-side token in Paddle (Developer tools → Authentication) for the overlay checkout.');
  if (!process.env.PADDLE_WEBHOOK_URL) console.log('No PADDLE_WEBHOOK_URL given: no webhook destination created. Local checkouts are still applied via the return-URL sync.');
} catch (e: any) { console.error(String(e.message ?? e).replaceAll(key, '***')); process.exit(1); }
