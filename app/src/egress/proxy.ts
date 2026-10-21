// Egress proxy for the scanner (Chromium). It resolves DNS itself and checks the resolved IP at connect time,
// then connects to exactly that IP, so a hostname that re-resolves to a private address between the app's
// check and the browser's connection (DNS rebinding) cannot reach internal services.
// Supports CONNECT (https) and absolute-URI requests (plain http). Only ports 80 and 443.
import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { isBlockedIp } from '../lib/ssrf.ts';

export type Resolver = (host: string) => Promise<string[]>;
export const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
export interface EgressOptions { resolver?: Resolver; ports?: number[]; isBlocked?: (ip: string) => boolean; connectTimeoutMs?: number; log?: (msg: string) => void }

export class EgressDenied extends Error {}
/** Resolve and pick the address to connect to. Rejects if ANY resolved address is non-public. */
export async function resolveAllowed(host: string, port: number, o: EgressOptions = {}): Promise<string> {
  const ports = o.ports ?? [80, 443]; const blocked = o.isBlocked ?? isBlockedIp;
  if (!ports.includes(port)) throw new EgressDenied(`port ${port} not allowed`);
  const h = host.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost)$/i.test(h)) throw new EgressDenied('loopback name');
  let addrs: string[];
  if (net.isIP(h)) addrs = [h];
  else { try { addrs = await (o.resolver ?? dnsResolver)(h); } catch { throw new EgressDenied('dns failure'); } }
  if (!addrs.length || addrs.some(blocked)) throw new EgressDenied('non-public address');
  return addrs[0];
}

export function createEgressProxy(o: EgressOptions = {}) {
  const log = o.log ?? (() => {});
  const server = http.createServer(async (req, res) => {
    // Absolute-URI proxy request for plain http.
    let u: URL; try { u = new URL(req.url ?? ''); } catch { res.writeHead(400).end(); return; }
    if (u.protocol !== 'http:') { res.writeHead(400).end(); return; }
    let ip: string;
    try { ip = await resolveAllowed(u.hostname, Number(u.port || 80), o); } catch (e: any) { log(`deny ${u.host}: ${e.message}`); res.writeHead(403, { 'content-type': 'text/plain' }).end('blocked by egress policy'); return; }
    const headers = { ...req.headers }; delete headers['proxy-connection']; delete headers['proxy-authorization'];
    const up = http.request({ host: ip, port: Number(u.port || 80), method: req.method, path: u.pathname + u.search, headers, timeout: o.connectTimeoutMs ?? 15000 }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); });
    req.pipe(up);
  });
  server.on('connect', async (req, client: net.Socket, head) => {
    client.on('error', () => {});
    const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url ?? '');
    if (!m) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    let ip: string;
    try { ip = await resolveAllowed(m[1], Number(m[2]), o); } catch (e: any) { log(`deny ${req.url}: ${e.message}`); client.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n'); return; }
    const up = net.connect({ host: ip, port: Number(m[2]), timeout: o.connectTimeoutMs ?? 15000 }, () => {
      up.setTimeout(0); client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) up.write(head); up.pipe(client); client.pipe(up);
    });
    up.on('timeout', () => up.destroy()); up.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  });
  return server;
}
