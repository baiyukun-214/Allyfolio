// Launch invite for confirmed waitlist members (EN / DE / ZH). Sent only by `npm run waitlist:invite -- --send`.
import { config } from '../config.ts';
import { carriedSite } from '../routes/auth.ts';
export type InviteLang = 'en' | 'de' | 'zh-CN';
export interface InviteRow { email: string; locale: string | null; site: string | null; early_bird: number }
export const inviteLang = (l: string | null | undefined): InviteLang => { const s = String(l ?? '').toLowerCase(); return s.startsWith('zh') ? 'zh-CN' : s.startsWith('de') ? 'de' : 'en'; };

/** Signup link: the app UI is English or Chinese (German readers get English), with their waitlist site prefilled. */
export function inviteLink(row: InviteRow) {
  const lang = inviteLang(row.locale) === 'zh-CN' ? 'zh-CN' : 'en';
  const site = carriedSite(row.site);
  return `${config.appUrl}/signup?lang=${lang}${site ? `&site=${encodeURIComponent(site)}` : ''}`;
}

interface Parts { link: string; email: string; site: string | null; early: boolean; code: string }
const TEXT: Record<InviteLang, { subject: string; body: (p: Parts) => string }> = {
  en: {
    subject: 'Your Allyfolio invite: the app is open',
    body: (p) => [
      'Hi,', '',
      'thanks for waiting. Allyfolio is open, and your place on the waitlist lets you in first. Create your account here:', p.link, '',
      ...(p.site ? [`We kept ${p.site} from your waitlist sign-up, so it is ready to add as your first site.`, ''] : []),
      ...(p.early ? ['Your early-bird offer: 30% off your first year on any monthly plan.',
        `Sign up with the same email (${p.email}) to keep your 30% early-bird discount. It is applied automatically at checkout.`,
        ...(p.code ? [`If you use a different email, enter the code ${p.code} on the Billing page before you check out.`] : []), ''] : []),
      'Plans start at €19 per month (excl. VAT). Cancel any time; full refund on request within 30 days of any payment.', '',
      'You get this email because you confirmed your place on the Allyfolio waitlist. This is the only invite we send; if you are no longer interested, just ignore it.', '',
      'Allyfolio',
    ].join('\n'),
  },
  de: {
    subject: 'Ihre Einladung zu Allyfolio: Die App ist jetzt verfügbar',
    body: (p) => [
      'Guten Tag,', '',
      'danke fürs Warten. Allyfolio ist jetzt verfügbar, und mit Ihrem Platz auf der Warteliste gehören Sie zu den Ersten. Hier legen Sie Ihr Konto an:', p.link, '',
      ...(p.site ? [`Wir haben ${p.site} aus Ihrer Anmeldung zur Warteliste übernommen. Sie können die Website direkt als erste hinzufügen.`, ''] : []),
      ...(p.early ? ['Ihr Frühbucher-Angebot: 30 % Rabatt auf Ihr erstes Jahr bei jedem Monatstarif.',
        `Registrieren Sie sich mit derselben E-Mail-Adresse (${p.email}), damit Sie Ihre 30 % Frühbucher-Rabatt behalten. Der Rabatt wird beim Bezahlen automatisch abgezogen.`,
        ...(p.code ? [`Wenn Sie eine andere E-Mail-Adresse verwenden, geben Sie vor dem Bezahlen auf der Seite „Billing“ (Abrechnung) den Code ${p.code} ein.`] : []), ''] : []),
      'Die Tarife beginnen bei 19 € pro Monat (zzgl. MwSt.). Jederzeit kündbar; volle Erstattung auf Anfrage innerhalb von 30 Tagen nach jeder Zahlung.',
      'Die App ist derzeit auf Englisch und Chinesisch verfügbar; Berichte und Berichts-E-Mails gibt es auch auf Deutsch.', '',
      'Sie erhalten diese E-Mail, weil Sie Ihren Platz auf der Allyfolio-Warteliste bestätigt haben. Dies ist die einzige Einladung, die wir senden. Wenn Sie kein Interesse mehr haben, ignorieren Sie sie einfach.', '',
      'Allyfolio',
    ].join('\n'),
  },
  'zh-CN': {
    subject: '您的 Allyfolio 邀请：应用现已开放',
    body: (p) => [
      '您好！', '',
      '感谢您的等待。Allyfolio 现已开放，作为候补名单成员，您可以优先使用。请在此创建账户：', p.link, '',
      ...(p.site ? [`我们保留了您加入候补名单时填写的 ${p.site}，注册后可直接将其添加为第一个网站。`, ''] : []),
      ...(p.early ? ['您的早鸟优惠：任意月付套餐首年享 7 折（30% off）。',
        `请使用同一邮箱（${p.email}）注册，以保留您的 7 折早鸟优惠。结账时将自动抵扣。`,
        ...(p.code ? [`如果您使用其他邮箱，请在结账前于“账单”页面输入折扣码 ${p.code}。`] : []), ''] : []),
      '套餐每月 €19 起（不含增值税）。可随时取消；任何一笔付款后 30 天内可申请全额退款。', '',
      '您收到此邮件，是因为您已确认加入 Allyfolio 候补名单。这是我们发送的唯一一封邀请；如果您不再感兴趣，请忽略此邮件。', '',
      'Allyfolio',
    ].join('\n'),
  },
};

export function inviteMail(row: InviteRow) {
  const lang = inviteLang(row.locale); const T = TEXT[lang];
  const code = config.billing.paddle.discountCodeId ? config.billing.paddle.discountCode : '';
  return { to: row.email, lang, subject: T.subject, text: T.body({ link: inviteLink(row), email: row.email, site: carriedSite(row.site), early: !!row.early_bird, code }) };
}
