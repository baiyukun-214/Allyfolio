import { get, all } from '../db.ts';
import { ruleHelp } from './scanner.ts';
import { t, type Locale } from '../i18n.ts';
/** Draft accessibility statement (structure follows the EU model statement). Written as a draft for the site owner to review. */
export function draftStatement(siteId: string, orgName: string, l: Locale = 'en'): string {
  const S = t(l).statement; const dl = t(l).dateLocale;
  const site = get<any>('SELECT * FROM sites WHERE id = ?', siteId);
  const scan = get<any>("SELECT * FROM scans WHERE site_id = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1", siteId);
  const top = scan ? all<any>('SELECT rule_id, help, wcag, COUNT(*) AS n FROM scan_issues WHERE scan_id = ? AND impact IN (\'critical\',\'serious\') GROUP BY rule_id ORDER BY n DESC LIMIT 8', scan.id) : [];
  const date = (iso: string) => new Date(iso).toLocaleDateString(dl, { day: 'numeric', month: 'long', year: 'numeric' });
  const host = new URL(site.origin).hostname;
  return `# ${S.h1(host)}

> ${S.draft(date(new Date().toISOString()))}

${S.intro(orgName, host)}

## ${S.statusH}

${S.status(host)}

## ${S.knownH}
${scan ? (top.length ? top.map((x) => `- ${ruleHelp(x.rule_id, x.help, l)}${x.wcag ? ` (${x.wcag})` : ''} – ${S.foundOn(x.n)}`).join('\n') : `- ${S.noSerious}`) : `- ${S.noScan}`}
- ${S.addManual}

${S.working}

## ${S.howH}

- ${S.auto(scan ? S.latest(date(scan.finished_at), scan.pages_scanned) : '')}
- ${S.manual}
- ${S.noOverlay}

${S.prepared}

## ${S.feedbackH}

${S.feedback(host)}

## ${S.enforceH}

${S.enforce}
`;
}
