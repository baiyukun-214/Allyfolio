// Idempotent Paddle catalogue setup. Everything we create carries custom_data.allyfolio_key, so re-runs find and
// reuse it instead of creating duplicates. Results are written into the .env file; secrets are never printed.
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

export const WEBHOOK_EVENTS = ['subscription.created', 'subscription.updated', 'subscription.activated', 'subscription.past_due', 'subscription.paused',
  'subscription.resumed', 'subscription.canceled', 'transaction.completed', 'transaction.payment_failed'];
export const CATALOGUE = [
  { key: 'starter', env: 'PADDLE_PRICE_STARTER', product: 'Allyfolio Starter', cents: 1900, monthly: true },
  { key: 'business', env: 'PADDLE_PRICE_BUSINESS', product: 'Allyfolio Business', cents: 3900, monthly: true },
  { key: 'agency', env: 'PADDLE_PRICE_AGENCY', product: 'Allyfolio Agency', cents: 9900, monthly: true },
  { key: 'oneoff', env: 'PADDLE_PRICE_ONEOFF', product: 'Allyfolio one-off report', cents: 4900, monthly: false },
] as const;
const SECRET_KEYS = new Set(['PADDLE_WEBHOOK_SECRET', 'PADDLE_API_KEY', 'PADDLE_CLIENT_TOKEN']);

/** Set KEY=value lines in an env file (replace in place, else append). Other lines and comments are kept. */
export function updateEnvFile(path: string, values: Record<string, string>) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
  const done = new Set<string>();
  const out = lines.map((line) => {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/.exec(line);
    if (m && m[1] in values) { done.add(m[1]); return `${m[1]}=${values[m[1]]}`; }
    return line;
  });
  const missing = Object.keys(values).filter((k) => !done.has(k));
  if (missing.length) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push('# written by npm run paddle:setup', ...missing.map((k) => `${k}=${values[k]}`), ''); }
  writeFileSync(path, out.join('\n'));
  try { chmodSync(path, 0o600); } catch { /* not fatal */ }
}

export interface SetupOptions { apiKey: string; apiBase: string; webhookUrl?: string; envPath: string; log?: (s: string) => void }
export async function runPaddleSetup(o: SetupOptions) {
  const log = o.log ?? console.log;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(path.startsWith('http') ? path : o.apiBase + path, { method, signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Paddle ${method} ${path.replace(/\?.*/, '')} → ${r.status} ${j?.error?.code ?? ''} ${j?.error?.detail ?? ''}`.trim());
    return j;
  };
  const list = async (path: string) => {
    const all: any[] = []; let next: string | null = path;
    for (let i = 0; next && i < 50; i++) { const j: any = await call('GET', next); all.push(...(j.data ?? [])); next = j.meta?.pagination?.has_more ? j.meta.pagination.next : null; }
    return all;
  };
  const created: string[] = []; const env: Record<string, string> = {};

  const products = await list('/products?status=active&per_page=200');
  const priceIds: Record<string, string> = {};
  for (const c of CATALOGUE) {
    let prod = products.find((p) => p.custom_data?.allyfolio_key === c.key);
    if (!prod) { prod = (await call('POST', '/products', { name: c.product, tax_category: 'saas', custom_data: { allyfolio_key: c.key } })).data; created.push(`product ${prod.id}`); }
    const prices = await list(`/prices?product_id=${prod.id}&status=active&per_page=200`);
    const ok = (p: any) => p.unit_price?.amount === String(c.cents) && p.unit_price?.currency_code === 'EUR' && (c.monthly ? p.billing_cycle?.interval === 'month' && p.billing_cycle?.frequency === 1 : !p.billing_cycle);
    let price = prices.find((p) => p.custom_data?.allyfolio_key === c.key && ok(p));
    for (const stale of prices.filter((p) => p.custom_data?.allyfolio_key === c.key && !ok(p))) { await call('PATCH', `/prices/${stale.id}`, { status: 'archived' }); log(`archived outdated price ${stale.id} (${stale.unit_price?.amount} ${stale.unit_price?.currency_code})`); }
    if (!price) {
      price = (await call('POST', '/prices', { product_id: prod.id, description: c.monthly ? `${c.product} – monthly` : c.product, name: c.monthly ? 'Monthly' : 'One-off',
        unit_price: { amount: String(c.cents), currency_code: 'EUR' }, ...(c.monthly ? { billing_cycle: { interval: 'month', frequency: 1 } } : {}), tax_mode: 'account_setting', custom_data: { allyfolio_key: c.key } })).data;
      created.push(`price ${price.id}`);
    }
    priceIds[c.key] = price.id; env[c.env] = price.id;
  }

  // Early bird: 30% off, recurring for the first 12 monthly billing periods, at most 100 redemptions, subscriptions only.
  const subPrices = ['starter', 'business', 'agency'].map((k) => priceIds[k]);
  const discounts = await list('/discounts?status=active&per_page=200');
  let d = discounts.find((x) => x.custom_data?.allyfolio_key === 'earlybird');
  const want = { description: 'Early bird – 30% off the first 12 months', type: 'percentage', amount: '30', recur: true, maximum_recurring_intervals: 12,
    usage_limit: 100, enabled_for_checkout: false, restrict_to: subPrices, custom_data: { allyfolio_key: 'earlybird' } };
  if (!d) { d = (await call('POST', '/discounts', want)).data; created.push(`discount ${d.id}`); }
  else if (JSON.stringify([...(d.restrict_to ?? [])].sort()) !== JSON.stringify([...subPrices].sort()) || Number(d.amount) !== 30 || d.maximum_recurring_intervals !== 12 || d.usage_limit !== 100 || !d.recur)
    { d = (await call('PATCH', `/discounts/${d.id}`, { amount: '30', recur: true, maximum_recurring_intervals: 12, usage_limit: 100, restrict_to: subPrices })).data; log(`updated discount ${d.id}`); }
  env.PADDLE_DISCOUNT_EARLYBIRD = d.id;

  // Webhook destination, only for a public URL (Paddle cannot reach localhost).
  if (o.webhookUrl) {
    const u = new URL(o.webhookUrl);
    if (u.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.host)) throw new Error('PADDLE_WEBHOOK_URL must be a public https URL (e.g. a cloudflared tunnel).');
    const settings = await list('/notification-settings');
    let n = settings.find((s) => s.destination === o.webhookUrl);
    if (!n) { n = (await call('POST', '/notification-settings', { description: 'Allyfolio app', type: 'url', destination: o.webhookUrl, subscribed_events: WEBHOOK_EVENTS, api_version: 1, include_sensitive_fields: false, traffic_source: 'all' })).data; created.push(`notification destination ${n.id}`); }
    else {
      const have = new Set((n.subscribed_events ?? []).map((e: any) => (typeof e === 'string' ? e : e.name)));
      if (WEBHOOK_EVENTS.some((e) => !have.has(e)) || n.active === false) { n = (await call('PATCH', `/notification-settings/${n.id}`, { subscribed_events: WEBHOOK_EVENTS, active: true })).data; log(`updated notification destination ${n.id}`); }
    }
    env.PADDLE_NOTIFICATION_SETTING_ID = n.id;
    if (n.endpoint_secret_key) env.PADDLE_WEBHOOK_SECRET = n.endpoint_secret_key;
  }

  updateEnvFile(o.envPath, env);
  for (const [k, v] of Object.entries(env)) log(`${k}=${SECRET_KEYS.has(k) ? '(written to .env, hidden)' : v}`);
  log(created.length ? `created: ${created.join(', ')}` : 'nothing new to create (already set up)');
  return { env, created };
}
