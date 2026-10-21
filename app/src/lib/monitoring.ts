// Optional error monitoring for any Sentry-compatible server (Sentry, self-hosted GlitchTip). Enabled only when
// SENTRY_DSN is set. Sends events via the documented envelope endpoint; no SDK dependency, no request bodies,
// cookies or user emails are sent.
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';

export interface Dsn { endpoint: string; publicKey: string }
export function parseDsn(dsn: string): Dsn | null {
  try {
    const u = new URL(dsn); const projectId = u.pathname.split('/').filter(Boolean).pop();
    if (!u.username || !projectId) return null;
    const prefix = u.pathname.replace(/\/[^/]+\/?$/, '');
    return { endpoint: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, publicKey: u.username };
  } catch { return null; }
}
const scrubUrl = (url?: string) => (url ?? '').replace(/([?&](token|_ptxn|code)=)[^&]+/gi, '$1[redacted]');

export function buildEnvelope(err: unknown, ctx: { method?: string; url?: string; release?: string } = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  const event_id = randomUUID().replace(/-/g, '');
  const frames = (e.stack ?? '').split('\n').slice(1).map((l) => {
    const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(l.trim()); return m ? { function: m[1] ?? '?', filename: m[2], lineno: +m[3], colno: +m[4] } : null;
  }).filter(Boolean).reverse();
  const event = {
    event_id, timestamp: Date.now() / 1000, platform: 'node', level: 'error', environment: process.env.NODE_ENV ?? 'development',
    release: ctx.release ?? process.env.APP_RELEASE, server_name: 'allyfolio-app',
    exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames } }] },
    ...(ctx.url ? { request: { method: ctx.method, url: scrubUrl(ctx.url) } } : {}),
  };
  return { event_id, body: `${JSON.stringify({ event_id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n` };
}

export async function captureException(err: unknown, ctx: { method?: string; url?: string } = {}, dsn = config.sentryDsn) {
  const d = dsn ? parseDsn(dsn) : null; if (!d) return false;
  const { body } = buildEnvelope(err, ctx);
  try {
    await fetch(d.endpoint, { method: 'POST', body, signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/x-sentry-envelope',
      'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${d.publicKey}, sentry_client=allyfolio/1.0` } });
    return true;
  } catch { return false; }
}

/** Wire into Fastify (5xx only) and the process. */
export function installMonitoring(app: any) {
  if (!config.sentryDsn) return;
  app.addHook('onError', async (req: any, reply: any, err: any) => { if ((err.statusCode ?? reply.statusCode ?? 500) >= 500) void captureException(err, { method: req.method, url: req.url }); });
  process.on('unhandledRejection', (r) => void captureException(r));
}
