import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { rateLimiter } from '../lib/ratelimit.ts';
import { freeLimit, cacheKey, cacheGet, cachePut, present, etaSeconds, recordDuration } from '../lib/freescan.ts';
import { parsePublicUrl, assertPublicHost, UnsafeUrlError } from '../lib/ssrf.ts';
import { scanPage, summarize, scanLoad } from '../lib/scanner.ts';
import { joinWaitlist, confirmWaitlist } from '../lib/waitlist.ts';
import { run, now } from '../db.ts';
import { page } from '../views/layout.ts';
import { html } from '../lib/html.ts';
import { normLocale, t, scanError, type Locale } from '../i18n.ts';

const waitlistLimit = rateLimiter(10, 3600_000);
/** API locale: explicit body/query lang wins, then the request locale (cookie / Accept-Language). */
const apiLocale = (req: any): Locale => normLocale(req.body?.lang) ?? normLocale(req.query?.lang) ?? req.locale ?? 'en';

export async function publicRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/scan/load', async () => {
    const { active, queued, slots } = scanLoad();
    return { active, queued, slots, busy: queued >= config.freeScanMaxQueue, etaS: etaSeconds(queued, active, slots) };
  });

  app.post('/api/scan', async (req, reply) => {
    const body = (req.body ?? {}) as any; const l = apiLocale(req); const T = t(l);
    let url: URL;
    try { url = parsePublicUrl(body.url); await assertPublicHost(url.hostname); }
    catch (e) { return reply.code(400).send(scanError(l, e instanceof UnsafeUrlError ? e.message : 'That does not look like a valid URL.')); }
    const key = cacheKey(url);
    const hit = body.rescan ? undefined : cacheGet(key);
    if (hit) return present(hit, l, true); // cache hits are free and do not count toward the limit
    const rl = freeLimit.check(req.ip);
    if (!rl.ok) return reply.code(429).header('retry-after', rl.retryAfterS).send({ code: 'rate_limited', error: T.scanErrors.rate_limited(config.freeScanPerHour, Math.max(1, Math.ceil(rl.retryAfterS / 60))), retryAfterS: rl.retryAfterS });
    const load = scanLoad();
    if (load.queued >= config.freeScanMaxQueue) {
      const retryAfterS = Math.max(15, etaSeconds(load.queued, load.active, load.slots));
      return reply.code(503).header('retry-after', retryAfterS).send({ code: 'busy', error: T.scanErrors.busy(retryAfterS), retryAfterS });
    }
    const h = freeLimit.begin(req.ip); let ok = false; const started = Date.now();
    try {
      let result;
      try { result = await scanPage(url.href); }
      catch (e) { req.log.warn({ err: (e as any)?.message }, 'free scan failed'); return reply.code(e instanceof UnsafeUrlError ? 400 : 502).send(scanError(l, e instanceof UnsafeUrlError ? e.message : 'The scan failed.')); }
      if (result.error) return reply.code(422).send(scanError(l, result.error));
      ok = true; recordDuration(Date.now() - started);
      const s = summarize(result.issues); const id = randomUUID(); const at = now();
      run(`INSERT INTO scans (id, site_id, kind, status, created_at, started_at, finished_at, pages_scanned, critical, serious, moderate, minor) VALUES (?,NULL,'free','done',?,?,?,1,?,?,?,?)`,
        id, at, at, at, s.counts.critical, s.counts.serious, s.counts.moderate, s.counts.minor);
      const entry = { id, url: result.finalUrl, scannedAt: at, at: Date.now(), issues: result.issues };
      let finalKey = key; try { finalKey = cacheKey(new URL(result.finalUrl)); } catch { /* keep input key */ }
      cachePut([key, finalKey], entry);
      return present(entry, l, false);
    } finally { freeLimit.end(h, ok); }
  });

  app.post('/api/waitlist', async (req, reply) => {
    const isForm = String(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded');
    const l = apiLocale(req); const T = t(l);
    const rl = waitlistLimit.take(req.ip);
    const r = rl.ok ? await joinWaitlist((req.body as any)?.email, req.ip, l, (req.body as any)?.site) : { ok: false as const, error: T.errors.tooMany };
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
