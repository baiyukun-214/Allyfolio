import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createEgressProxy, resolveAllowed, EgressDenied } from '../../src/egress/proxy.ts';
import { pinnedLookup, isBlockedIp } from '../../src/lib/ssrf.ts';
import { browserLaunchOptions } from '../../src/lib/scanner.ts';

// Upstream on loopback; the proxy is told 127.0.0.1 is "public" ONLY for the positive-path test via isBlocked.
const upstream = http.createServer((_q, r) => r.end('upstream-ok')); await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
const upPort = (upstream.address() as any).port;
after(() => upstream.close());
const listen = async (s: http.Server) => { await new Promise<void>((r) => s.listen(0, '127.0.0.1', r)); return (s.address() as any).port as number; };
const connect = (port: number, target: string) => new Promise<string>((resolve) => {
  const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nhost: ${target}\r\n\r\n`));
  let b = ''; s.on('data', (c) => { b += c; if (b.includes('\r\n\r\n')) { s.destroy(); resolve(b.split('\r\n')[0]); } }); s.on('error', () => resolve(b));
});

test('blocks private IP literals, loopback names, private DNS answers and non-web ports', async () => {
  const resolver = async (h: string) => ({ 'evil.example': ['127.0.0.1'], 'mixed.example': ['93.184.216.34', '10.0.0.5'], 'meta.example': ['169.254.169.254'], 'v6.example': ['::ffff:127.0.0.1'] } as any)[h] ?? ['93.184.216.34'];
  const p = createEgressProxy({ resolver }); const port = await listen(p);
  try {
    for (const t of ['10.0.0.1:443', '127.0.0.1:80', '[::1]:443', 'localhost:443', 'evil.example:443', 'mixed.example:443', 'meta.example:80', 'v6.example:443', 'public.example:22', 'public.example:6379'])
      assert.match(await connect(port, t), /403/, t);
    const r = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' }).catch(() => null); // origin-form request is rejected
    assert.equal(r?.status, 400);
    const plain = await new Promise<number>((res) => http.get({ host: '127.0.0.1', port, path: 'http://evil.example/' }, (x) => { x.resume(); res(x.statusCode!); }));
    assert.equal(plain, 403, 'absolute-URI http to a private answer is blocked');
  } finally { p.close(); }
});

test('DNS rebinding: each connection is checked against the address actually used', async () => {
  let n = 0; const answers = [['93.184.216.34'], ['127.0.0.1']];
  const resolver = async () => answers[Math.min(n++, 1)];
  assert.equal(await resolveAllowed('rebind.example', 443, { resolver }), '93.184.216.34');
  await assert.rejects(resolveAllowed('rebind.example', 443, { resolver }), EgressDenied);
  // pinnedLookup (safeFetch): the validated answer is the one handed to the socket
  let m = 0; const lk = pinnedLookup(async () => (m++ === 0 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]));
  const call = () => new Promise<any>((res) => lk('rebind.example', {}, (e: any, a: any) => res(e ?? a)));
  assert.equal(await call(), '93.184.216.34');
  assert.match(String((await call()).message), /not publicly reachable/);
});

test('allowed targets are tunnelled to the pinned IP (CONNECT and absolute-URI)', async () => {
  const p = createEgressProxy({ resolver: async () => ['127.0.0.1'], ports: [upPort], isBlocked: (ip) => ip !== '127.0.0.1' && isBlockedIp(ip) });
  const port = await listen(p);
  try {
    assert.match(await connect(port, `site.example:${upPort}`), /200/);
    const body = await new Promise<string>((res) => http.get({ host: '127.0.0.1', port, path: `http://site.example:${upPort}/x`, headers: { host: `site.example:${upPort}` } }, (x) => { let b = ''; x.on('data', (c) => (b += c)); x.on('end', () => res(b)); }));
    assert.equal(body, 'upstream-ok');
  } finally { p.close(); }
});

test('Chromium is routed through SCAN_PROXY incl. loopback, WebRTC kept off UDP', async () => {
  const { config } = await import('../../src/config.ts');
  const prev = config.scanProxy; (config as any).scanProxy = 'http://egress:3128';
  try {
    const o: any = browserLaunchOptions();
    assert.equal(o.proxy.server, 'http://egress:3128'); assert.ok(o.args.includes('--proxy-bypass-list=<-loopback>'));
    assert.ok(o.args.some((a: string) => a.includes('disable_non_proxied_udp')));
  } finally { (config as any).scanProxy = prev; }
});
