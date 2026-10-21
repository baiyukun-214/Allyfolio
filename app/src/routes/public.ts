import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { rateLimiter } from '../lib/ratelimit.ts';
import { parsePublicUrl, assertPublicHost, UnsafeUrlError } from '../lib/ssrf.ts';
import { scanPage, summarize, AUTOMATION_NOTE } from '../lib/scanner.ts';
import { joinWaitlist, confirmWaitlist } from '../lib/waitlist.ts';
import { run, now } from '../db.ts';
import { page } from '../views/layout.ts';
import { html } from '../lib/html.ts';

const scanLimit = rateLimiter(config.freeScanPerHour, 3600_000);
const waitlistLimit = rateLimiter(10, 3600_000);

export async function publicRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/scan', async (req, reply) => {
    const body = (req.body ?? {}) as any;
    let url: URL;
    try { url = parsePublicUrl(body.url); await assertPublicHost(url.hostname); }
    catch (e) { return reply.code(400).send({ error: e instanceof UnsafeUrlError ? e.message : 'Invalid URL.' }); }
    const rl = scanLimit.take(req.ip);
    if (!rl.ok) return reply.code(429).header('retry-after', rl.retryAfterS).send({ error: `You have reached the limit of ${config.freeScanPerHour} free scans per hour. Please try again later.` });
    let result;
    try { result = await scanPage(url.href); }
    catch (e) { return reply.code(400).send({ error: e instanceof UnsafeUrlError ? e.message : 'The scan failed.' }); }
    if (result.error) return reply.code(422).send({ error: result.error });
    const s = summarize(result.issues);
    const id = randomUUID();
    run(`INSERT INTO scans (id, site_id, kind, status, created_at, started_at, finished_at, pages_scanned, critical, serious, moderate, minor) VALUES (?,NULL,'free','done',?,?,?,1,?,?,?,?)`,
      id, now(), now(), now(), s.counts.critical, s.counts.serious, s.counts.moderate, s.counts.minor);
    return { id, url: result.finalUrl, scannedAt: now(), total: s.total, counts: s.counts,
      byImpact: s.byImpact.map((g) => ({ impact: g.impact, count: g.count, rules: g.rules.map(({ ruleId, help, helpUrl, wcag, count }) => ({ ruleId, help, helpUrl, wcag, count })) })),
      note: AUTOMATION_NOTE };
  });

  app.post('/api/waitlist', async (req, reply) => {
    const isForm = String(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded');
    const rl = waitlistLimit.take(req.ip);
    const r = rl.ok ? await joinWaitlist((req.body as any)?.email, req.ip) : { ok: false as const, error: 'Too many attempts. Please try again later.' };
    if (isForm) {
      const back = config.siteOrigins[0] ?? config.appUrl;
      return reply.redirect(`${back}/waitlist-${r.ok ? 'check-email' : 'error'}`, 303);
    }
    if (!r.ok) return reply.code(rl.ok ? 400 : 429).send({ error: r.error });
    return { ok: true, message: 'Check your inbox and click the link to confirm your email.' };
  });

  app.get('/api/waitlist/confirm', async (req, reply) => {
    const r = confirmWaitlist((req.query as any).token);
    reply.type('text/html');
    return page({ title: r.ok ? 'You are on the list' : 'Link not valid', body: html`
      <div class="narrow card">
        <h1>${r.ok ? 'You are on the waitlist' : 'This link is not valid'}</h1>
        <p>${r.ok ? (r.earlyBird ? 'Thanks for confirming. You are one of the first 100 members, so you get 30% off your first year.' : 'Thanks for confirming. We will email you when Allyfolio launches.') : 'The confirmation link is invalid or has expired. Please sign up again.'}</p>
        <p><a href="${config.siteOrigins[0] ?? '/'}">Back to allyfolio.com</a></p>
      </div>` });
  });
}
