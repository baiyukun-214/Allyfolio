// Creates Allyfolio products, monthly EUR prices, the one-off price and the early-bird discount in the Paddle SANDBOX.
// Usage: PADDLE_ENV=sandbox PADDLE_API_KEY=... npm run paddle:setup   → prints env lines to paste into .env
const key = process.env.PADDLE_API_KEY ?? '';
if (process.env.PADDLE_ENV !== 'sandbox' || !key) { console.error('Refusing to run: set PADDLE_ENV=sandbox and a sandbox PADDLE_API_KEY.'); process.exit(1); }
const api = async (path: string, body: unknown) => {
  const r = await fetch('https://sandbox-api.paddle.com' + path, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j: any = await r.json(); if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j.error)}`); return j.data;
};
const out: string[] = [];
for (const [env, name, cents] of [['STARTER', 'Allyfolio Starter', 1900], ['BUSINESS', 'Allyfolio Business', 3900], ['AGENCY', 'Allyfolio Agency', 9900]] as const) {
  const p = await api('/products', { name, tax_category: 'saas' });
  const price = await api('/prices', { product_id: p.id, description: `${name} monthly`, name: 'Monthly', unit_price: { amount: String(cents), currency_code: 'EUR' }, billing_cycle: { interval: 'month', frequency: 1 }, tax_mode: 'account_setting' });
  out.push(`PADDLE_PRICE_${env}=${price.id}`);
}
const one = await api('/products', { name: 'Allyfolio one-off report', tax_category: 'saas' });
out.push(`PADDLE_PRICE_ONEOFF=${(await api('/prices', { product_id: one.id, description: 'One-off report', name: 'One-off report', unit_price: { amount: '4900', currency_code: 'EUR' }, tax_mode: 'account_setting' })).id}`);
const d = await api('/discounts', { description: 'Early bird – 30% off the first year', type: 'percentage', amount: '30', recur: true, maximum_recurring_intervals: 12, usage_limit: 100, enabled_for_checkout: false });
out.push(`PADDLE_DISCOUNT_EARLYBIRD=${d.id}`);
console.log(out.join('\n'));
console.log('\nNext: in the Paddle sandbox dashboard create a notification destination for <APP_URL>/api/billing/webhook (events: subscription.created/updated/activated/past_due/paused/resumed/canceled, transaction.completed, transaction.payment_failed), copy its secret into PADDLE_WEBHOOK_SECRET, create a client-side token (PADDLE_CLIENT_TOKEN) and set a default payment link (Checkout settings) to <APP_URL>/app/billing.');
