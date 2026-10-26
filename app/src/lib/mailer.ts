import { config } from '../config.ts';
export interface Mail { to: string; subject: string; text: string; html?: string }
export interface Mailer { send(m: Mail): Promise<void> }
export const sentMail: Mail[] = []; // dev/test inspection

/** Development: prints mail to the log. */
export class ConsoleMailer implements Mailer {
  async send(m: Mail) { sentMail.push(m); if (sentMail.length > 200) sentMail.shift(); console.log(`\n[mail] to=${m.to} subject="${m.subject}"\n${m.text}\n`); }
}
/**
 * Resend (https://resend.com). The sending region is chosen per verified domain in Resend (use eu-west-1 for allyfolio.com);
 * the API endpoint is RESEND_API_URL (default https://api.resend.com). From: MAIL_FROM (hello@allyfolio.com).
 */
export class ResendMailer implements Mailer {
  constructor(private apiKey: string, private apiUrl = config.resendApiUrl, private from = config.mailFrom) {}
  async send(m: Mail) {
    const r = await fetch(`${this.apiUrl}/emails`, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
}
export const mailer: Mailer = (() => {
  if (config.mailer === 'console') return new ConsoleMailer();
  if (config.mailer === 'resend') {
    if (!config.resendApiKey) { console.warn('[mail] MAILER=resend but RESEND_API_KEY is empty – logging emails to the console instead of sending.'); return new ConsoleMailer(); }
    return new ResendMailer(config.resendApiKey);
  }
  throw new Error(`MAILER=${config.mailer} is not supported (use console or resend)`);
})();
