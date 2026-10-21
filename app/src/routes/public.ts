import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { rateLimiter } from '../lib/ratelimit.ts';
import { parsePublicUrl, assertPublicHost, UnsafeUrlError } from '../lib/ssrf.ts';
import { scanPage, summarize, ruleHelp } from '../lib/scanner.ts';
import { joinWaitlist, confirmWaitlist } from '../lib/waitlist.ts';
import { run, now } from '../db.ts';
import { page } from '../views/layout.ts';
import { html } from '../lib/html.ts';
import { normLocale, t, trError, type Locale } from '../i18n.ts';

const scanLimit = rateLimiter(config.freeScanPerHour, 3600_000);
const waitlistLimit = rateLimiter(10, 3600_000);
/** API locale: explicit body/query lang wins, then the request locale (cookie / Accept-Language). */
const apiLocale = (req: any): Locale => normLocale(req.body?.lang) ?? normLocale(req.query?.lang) ?? req.locale ?? 'en';

export async function publicRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/scan', async (req, reply) => {
    const body = (req.body ?? {}) as any; const l = apiLocale(req); const T = t(l);
    let url: URL;
    try { url = parsePublicUrl(body.url); await assertPublicHost(url.hostname); }
    catch (e) { return reply.code(400).send({ error: e instanceof UnsafeUrlError ? trError(l, e.message) : T.errors.invalidUrl }); }
    const rl = scanLimit.take(req.ip);
    if (!rl.ok) return reply.code(429).header('retry-after', rl.retryAfterS).send({ error: T.errors.scanLimit(config.freeScanPerHour) });
    let result;
    try { result = await scanPage(url.href); }
    catch (e) { return reply.code(400).send({ error: e instanceof UnsafeUrlError ? trError(l, e.message) : T.errors.scanFail }); }
    if (result.error) return reply.code(422).send({ error: trError(l, result.error) });
    const s = summarize(result.issues);
    const id = randomUUID();
    run(`INSERT INTO scans (id, site_id, kind, status, created_at, started_at, finished_at, pages_scanned, critical, serious, moderate, minor) VALUES (?,NULL,'free','done',?,?,?,1,?,?,?,?)`,
      id, now(), now(), now(), s.counts.critical, s.counts.serious, s.counts.moderate, s.counts.minor);
    return { id, lang: l, url: result.finalUrl, scannedAt: now(), total: s.total, counts: s.counts,
      byImpact: s.byImpact.map((g) => ({ impact: g.impact, label: T.impacts[g.impact] ?? g.impact, count: g.count,
        rules: g.rules.map(({ ruleId, help, helpUrl, wcag, count }) => ({ ruleId, help: ruleHelp(ruleId, help, l), helpUrl, wcag, count })) })),
      note: T.automationNote };
  });

  app.post('/api/waitlist', async (req, reply) => {
    const isForm = String(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded');
    const l = apiLocale(req); const T = t(l);
    const rl = waitlistLimit.take(req.ip);
    const r = rl.ok ? await joinWaitlist((req.body as any)?.email, req.ip, l) : { ok: false as const, error: T.errors.tooMany };
    if (isForm) {
      const back = config.siteOrigins[0] ?? config.appUrl;
      return reply.redirect(`${back}${l === 'zh-CN' ? '/zh' : ''}/waitlist-${r.ok ? 'check-email' : 'error'}`, 303);
    }
    if (!r.ok) return reply.code(rl.ok ? 400 : 429).send({ error: r.error });
    return { ok: true, message: T.waitlist.ok };
  });

  app.get('/api/waitlist/confirm', async (req, reply) => {
    const r = confirmWaitlist((req.query as any).token);
    const l: Locale = r.locale ?? req.locale; const W = t(l).waitlist;
    const site = config.siteOrigins[0] ?? '';
    reply.type('text/html');
    return page({ locale: l, path: req.url.split('?')[0], title: r.ok ? W.confirmedTitle : W.invalidTitle, body: html`
      <div class="narrow card">
        <h1>${r.ok ? W.confirmedTitle : W.invalidTitle}</h1>
        <p>${r.ok ? (r.earlyBird ? W.confirmedEarly : W.confirmed) : W.invalid}</p>
        <p><a href="${site ? site + (l === 'zh-CN' ? '/zh' : '') : '/'}">${W.back}</a></p>
      </div>` });
  });
}
