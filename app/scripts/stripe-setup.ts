// Creates Allyfolio products, monthly EUR prices, the one-off price and the early-bird coupon in Stripe TEST mode.
// Usage: STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup   → prints env lines to paste into .env
import Stripe from 'stripe';
const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!key.startsWith('sk_test_')) { console.error('Refusing to run: STRIPE_SECRET_KEY must be a TEST key (sk_test_...).'); process.exit(1); }
const stripe = new Stripe(key);
const plans = [['STARTER', 'Allyfolio Starter', 1900], ['BUSINESS', 'Allyfolio Business', 3900], ['AGENCY', 'Allyfolio Agency', 9900]] as const;
const out: string[] = [];
for (const [env, name, cents] of plans) {
  const p = await stripe.products.create({ name });
  const price = await stripe.prices.create({ product: p.id, currency: 'eur', unit_amount: cents, recurring: { interval: 'month' }, tax_behavior: 'exclusive', lookup_key: `allyfolio_${env.toLowerCase()}_monthly` });
  out.push(`STRIPE_PRICE_${env}=${price.id}`);
}
const one = await stripe.products.create({ name: 'Allyfolio one-off report' });
out.push(`STRIPE_PRICE_ONEOFF=${(await stripe.prices.create({ product: one.id, currency: 'eur', unit_amount: 3900, tax_behavior: 'exclusive', lookup_key: 'allyfolio_oneoff' })).id}`);
const coupon = await stripe.coupons.create({ name: 'Early bird – 30% off first year', percent_off: 30, duration: 'repeating', duration_in_months: 12, max_redemptions: 100 });
out.push(`STRIPE_COUPON_EARLYBIRD=${coupon.id}`);
console.log(out.join('\n'));
console.log('\nNext: create a webhook endpoint for <APP_URL>/api/stripe/webhook (events: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.payment_failed) and set STRIPE_WEBHOOK_SECRET. Configure the customer portal to allow plan switching with "prorate" for upgrades.');
