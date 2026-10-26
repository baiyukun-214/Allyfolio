import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { provider } from '../lib/billing/index.ts';
import { paddleLocale } from '../lib/billing/paddle.ts';
import { page } from '../views/layout.ts';
import { html } from '../lib/html.ts';
import type { Locale } from '../i18n.ts';

/**
 * Paddle default payment link (Checkout settings → Default payment link = https://app.allyfolio.com/pay).
 * Paddle sends buyers to /pay?_ptxn=txn_…; Paddle.js opens checkout for that transaction automatically after Paddle.Initialize.
 * Environment (sandbox / live) and client-side token come from the existing PADDLE_ENV / PADDLE_CLIENT_TOKEN config.
 */
const S = {
  en: { title: 'Checkout', loading: 'Opening secure checkout…', none: 'There is no payment to complete here. If you received a payment link, open it again, or go to Billing to choose a plan.',
    billing: 'Go to Billing', thanks: 'Thank you! Your payment was received. Redirecting to Billing…', unavailable: 'Checkout is not available right now. Please try again later or contact support.' },
  zh: { title: '结账', loading: '正在打开安全结账页面…', none: '这里没有需要完成的付款。如果你收到了付款链接，请重新打开它，或前往“账单”选择套餐。',
    billing: '前往账单', thanks: '谢谢！我们已收到你的付款，正在跳转到账单页面…', unavailable: '结账暂时不可用，请稍后再试或联系支持。' },
};

export async function payRoutes(app: FastifyInstance) {
  app.get('/pay', async (req, reply) => {
    const l: Locale = (req as any).locale ?? 'en';
    const T = l === 'zh-CN' ? S.zh : S.en;
    const ptxn = String((req.query as any)?._ptxn ?? '');
    const has = /^txn_[a-z0-9]+$/.test(ptxn);
    const client = (await provider())?.clientConfig() ?? null;
    reply.type('text/html').header('cache-control', 'no-store');
    return page({ locale: l, path: '/pay', title: T.title, body: html`
      <div class="narrow card">
        <h1>${T.title}</h1>
        <p id="pay-msg" role="status" aria-live="polite">${!client ? T.unavailable : has ? T.loading : T.none}</p>
        <p><a class="btn btn-secondary" href="/app/billing">${T.billing}</a></p>
      </div>
      ${client ? html`<div id="paddle-pay" hidden data-token="${client.token}" data-env="${client.environment}" data-locale="${paddleLocale(l)}"
        data-success="${config.appUrl}/app/billing?paid=1" data-thanks="${T.thanks}"></div>
        <script src="${client.script}" defer></script><script src="/static/pay.js" defer></script>` : ''}` });
  });
}
