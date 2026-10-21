import { config } from '../config.ts';
export interface Mail { to: string; subject: string; text: string; html?: string }
export interface Mailer { send(m: Mail): Promise<void> }
export const sentMail: Mail[] = []; // dev/test inspection
class ConsoleMailer implements Mailer {
  async send(m: Mail) { sentMail.push(m); if (sentMail.length > 200) sentMail.shift(); console.log(`\n[mail] to=${m.to} subject="${m.subject}"\n${m.text}\n`); }
}
// Pluggable: implement Mailer for your provider (Postmark, SES eu-central-1, Brevo, ...) and select it here.
export const mailer: Mailer = (() => {
  if (config.mailer === 'console') return new ConsoleMailer();
  throw new Error(`MAILER=${config.mailer} is not implemented yet – add a Mailer in src/lib/mailer.ts`);
})();
