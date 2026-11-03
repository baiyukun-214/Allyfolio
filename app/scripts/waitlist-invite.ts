// Launch invite for confirmed waitlist members. DRY RUN BY DEFAULT: prints who would get which mail and sends nothing.
//   npm run waitlist:invite                          dry run: recipients + one full preview per language
//   npm run waitlist:invite -- --to a@b.c            dry run for one address
//   npm run waitlist:invite -- --send --to a@b.c     send to one address (test)
//   npm run waitlist:invite -- --send [--limit 20]   send to everyone not invited yet (or the first N)
// Skips unconfirmed entries, people who already have an account, and anyone already invited (unless --resend).
// With MAILER=console the mail is only logged, and nobody is marked as invited.
import { all, run, now } from '../src/db.ts';
import { mailer, ConsoleMailer } from '../src/lib/mailer.ts';
import { inviteMail, type InviteRow } from '../src/lib/invite.ts';
const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const known = new Set(['--send', '--resend', '--all-previews']); const withValue = new Set(['--to', '--limit']);
for (let i = 0; i < argv.length; i++) { if (withValue.has(argv[i])) { i++; continue; } if (!known.has(argv[i])) { console.error(`unknown option ${argv[i]}`); process.exit(1); } }
const send = argv.includes('--send'); const to = opt('--to')?.toLowerCase(); const limit = opt('--limit') ? Number(opt('--limit')) : Infinity;
if (!(limit > 0)) { console.error('--limit must be a positive number'); process.exit(1); }

const rows = all<InviteRow & { invited_at: string | null }>(`SELECT w.email, w.locale, w.site, w.early_bird, w.invited_at FROM waitlist w
  WHERE w.confirmed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = w.email) ${argv.includes('--resend') ? '' : 'AND w.invited_at IS NULL'}
  ${to ? 'AND w.email = ?' : ''} ORDER BY w.confirmed_at`, ...(to ? [to] : [])).slice(0, limit);
const mails = rows.map(inviteMail);
const by = (l: string) => mails.filter((m) => m.lang === l).length;
console.log(`${send ? 'SEND' : 'DRY RUN – nothing is sent'}: ${mails.length} recipient(s) (en ${by('en')}, de ${by('de')}, zh-CN ${by('zh-CN')}; early bird ${rows.filter((r) => r.early_bird).length})`);
for (const [i, m] of mails.entries()) console.log(`  to=${m.to} lang=${m.lang} early_bird=${rows[i].early_bird ? 'yes' : 'no'} site=${rows[i].site ?? '-'}`);

if (!send) {
  const shown = new Set<string>();
  for (const m of mails) { if (!argv.includes('--all-previews') && shown.has(m.lang)) continue; shown.add(m.lang);
    console.log(`\n----- preview (${m.lang}) to=${m.to}\nSubject: ${m.subject}\n\n${m.text}\n-----`); }
  console.log('\nNothing was sent. Re-run with --send (try --send --to <your address> first).');
  process.exit(0);
}
const consoleOnly = mailer instanceof ConsoleMailer;
let ok = 0, failed = 0;
for (const m of mails) {
  try {
    await mailer.send({ to: m.to, subject: m.subject, text: m.text });
    if (!consoleOnly) run('UPDATE waitlist SET invited_at = ? WHERE email = ?', now(), m.to);
    ok++;
  } catch (e: any) { failed++; console.error(`failed to=${m.to}: ${String(e.message ?? e).slice(0, 200)}`); }
  await new Promise((r) => setTimeout(r, 300)); // stay well below the mail provider's rate limit
}
console.log(`done: ${ok} sent, ${failed} failed${consoleOnly ? ' (MAILER=console: logged only, nobody marked as invited)' : ''}`);
