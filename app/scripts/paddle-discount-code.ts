// Creates (or finds) only the early-bird fallback DISCOUNT CODE in Paddle – nothing else in the catalogue is touched.
// Sandbox by default; refuses a live key unless PADDLE_ENV=production and --production are both given (launch day).
// Prints the discount ID and code (not secret) and the two .env lines to set; never prints keys.
//   npm run paddle:discount-code                       (uses PADDLE_API_KEY / PADDLE_PRICE_* from .env or the environment)
//   npm run paddle:discount-code -- --webhook-events   (also subscribes the existing PADDLE_NOTIFICATION_SETTING_ID to adjustment.* refund events)
//   PADDLE_DISCOUNT_CODE=MYCODE npm run paddle:discount-code   (code string; default EARLYBIRD30)
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureDiscountCode, codeFromEnv, WEBHOOK_EVENTS } from '../src/lib/billing/paddleSetup.ts';
const envPath = resolve(process.env.ENV_FILE ?? '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const E = process.env;
const env = E.PADDLE_ENV === 'production' || E.PADDLE_ENV === 'live' ? 'production' : 'sandbox';
const key = E.PADDLE_API_KEY ?? '';
const die = (m: string) => { console.error(m); process.exit(1); };
if (!key) die('PADDLE_API_KEY is not set.');
if (env === 'sandbox' && !key.startsWith('pdl_sdbx_')) die('PADDLE_ENV=sandbox but PADDLE_API_KEY is not a sandbox key: refusing.');
if (env === 'production' && !process.argv.includes('--production')) die('PADDLE_ENV=production: re-run with -- --production to confirm (launch only).');
const subPrices = [E.PADDLE_PRICE_STARTER, E.PADDLE_PRICE_BUSINESS, E.PADDLE_PRICE_AGENCY].filter(Boolean) as string[];
if (subPrices.length !== 3) die('PADDLE_PRICE_STARTER/BUSINESS/AGENCY must be set (run npm run paddle:setup first).');
const apiBase = E.PADDLE_API_BASE || (env === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(path.startsWith('http') ? path : apiBase + path, { method, signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Paddle ${method} ${path.replace(/\?.*/, '')} → ${r.status} ${j?.error?.code ?? ''} ${j?.error?.detail ?? ''}`.trim());
  return j;
};
const list = async (path: string) => { const all: any[] = []; let next: string | null = path;
  for (let i = 0; next && i < 50; i++) { const j: any = await call('GET', next); all.push(...(j.data ?? [])); next = j.meta?.pagination?.has_more ? j.meta.pagination.next : null; } return all; };
try {
  console.log(`Paddle ${env}: discount code`);
  const d = await ensureDiscountCode(call, list, subPrices, codeFromEnv());
  console.log(`${d.created ? 'created' : 'found'} ${d.id} code=${d.code}`);
  console.log(`Set in .env:\nPADDLE_DISCOUNT_CODE_ID=${d.id}\nPADDLE_DISCOUNT_CODE=${d.code}`);
  if (process.argv.includes('--webhook-events')) {
    const id = E.PADDLE_NOTIFICATION_SETTING_ID; if (!id) die('PADDLE_NOTIFICATION_SETTING_ID is not set.');
    const n = (await call('GET', `/notification-settings/${id}`)).data;
    const have = new Set((n.subscribed_events ?? []).map((e: any) => (typeof e === 'string' ? e : e.name)));
    const missing = WEBHOOK_EVENTS.filter((e) => !have.has(e));
    if (missing.length) { await call('PATCH', `/notification-settings/${id}`, { subscribed_events: [...have, ...missing] }); console.log(`webhook ${id}: added ${missing.join(', ')}`); }
    else console.log(`webhook ${id}: already subscribed to all events`);
  }
} catch (e: any) { console.error(String(e.message ?? e).replaceAll(key, '***')); process.exit(1); }
