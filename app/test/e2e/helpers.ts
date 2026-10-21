import http from 'node:http';
process.env.ALLOW_PRIVATE_TARGETS = '1';
process.env.DATABASE_PATH = ':memory:';
process.env.WORKER = '0';
process.env.LOG_LEVEL = 'warn';
export async function fixtureServer(routes: Record<string, string | ((req: http.IncomingMessage, res: http.ServerResponse) => void)>) {
  const s = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const r = routes[path] ?? routes['*'];
    if (typeof r === 'function') return r(req, res);
    if (r === undefined) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': path.endsWith('.xml') ? 'application/xml' : 'text/html' }); res.end(r);
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { server: s, base: `http://127.0.0.1:${(s.address() as any).port}` };
}
/** Browser-ish client over fastify.inject with a cookie jar + CSRF extraction. */
export function client(app: any) {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const req = async (method: string, url: string, form?: Record<string, string>) => {
    const res = await app.inject({ method, url, headers: { cookie: cookie(), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, payload: form ? new URLSearchParams(form).toString() : undefined });
    for (const c of res.cookies) { if (c.value) jar.set(c.name, c.value); else jar.delete(c.name); }
    return res;
  };
  const csrf = async (pageUrl: string) => { const r = await req('GET', pageUrl); const m = r.body.match(/name="_csrf" value="([^"]+)"/); return m?.[1] ?? ''; };
  const post = async (url: string, form: Record<string, string>, csrfFrom = '/app') => req('POST', url, { ...form, _csrf: await csrf(csrfFrom) });
  return { req, post, csrf, jar };
}
