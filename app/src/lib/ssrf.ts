import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config.ts';

export class UnsafeUrlError extends Error { constructor(msg: string) { super(msg); this.name = 'UnsafeUrlError'; } }

function v4ToInt(ip: string) { return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0; }
const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
];
function v4Blocked(ip: string) {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => { const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0; return (n & mask) === (v4ToInt(base) & mask); });
}
function expandV6(ip: string): number[] {
  let [head, tail] = ip.split('::') as [string, string | undefined];
  const parse = (s: string) => (s ? s.split(':') : []).flatMap((p) => p.includes('.') ? (() => { const n = v4ToInt(p); return [(n >>> 16).toString(16), (n & 0xffff).toString(16)]; })() : [p]);
  const h = parse(head), t = tail !== undefined ? parse(tail) : [];
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16));
}
/** True if the IP is loopback, private, link-local, unique-local, multicast, reserved, or otherwise not public. */
export function isBlockedIp(ip: string): boolean {
  const zoneless = ip.replace(/%.*$/, '').replace(/^\[|\]$/g, '');
  if (net.isIPv4(zoneless)) return v4Blocked(zoneless);
  if (!net.isIPv6(zoneless)) return true;
  const w = expandV6(zoneless);
  if (w.every((x) => x === 0)) return true;                       // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d, IPv4-compatible, NAT64 64:ff9b::/96 → check embedded v4
  const embedded = `${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`;
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return v4Blocked(embedded);
  if (w[0] === 0x64 && w[1] === 0xff9b) return v4Blocked(embedded);
  if (w[0] === 0x2002) return v4Blocked(`${w[1] >> 8}.${w[1] & 255}.${w[2] >> 8}.${w[2] & 255}`); // 6to4
  if ((w[0] & 0xfe00) === 0xfc00) return true;  // fc00::/7 ULA
  if ((w[0] & 0xffc0) === 0xfe80) return true;  // fe80::/10 link-local
  if ((w[0] & 0xffc0) === 0xfec0) return true;  // fec0::/10 site-local (deprecated)
  if ((w[0] & 0xff00) === 0xff00) return true;  // multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // documentation
  if (w[0] === 0x2001 && w[1] < 0x200) return true;    // 2001::/23 IETF protocol assignments (Teredo etc.)
  if (w[0] === 0x0100 && w.slice(1, 4).every((x) => x === 0)) return true; // discard-only
  return false;
}

/** Validate shape of a user-supplied URL; returns normalised URL. Does not resolve DNS. */
export function parsePublicUrl(input: string): URL {
  let raw = String(input ?? '').trim();
  if (!raw) throw new UnsafeUrlError('Please enter a URL.');
  if (raw.length > 2048) throw new UnsafeUrlError('That URL is too long.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
  let u: URL;
  try { u = new URL(raw); } catch { throw new UnsafeUrlError('That does not look like a valid URL.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError('Only http and https URLs can be scanned.');
  if (u.username || u.password) throw new UnsafeUrlError('URLs with credentials are not allowed.');
  if (u.port && !['80', '443', ''].includes(u.port) && !config.allowPrivateTargets) throw new UnsafeUrlError('Only standard ports (80 and 443) can be scanned.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!config.allowPrivateTargets) {
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i.test(host)) throw new UnsafeUrlError('That address is not publicly reachable.');
    if (net.isIP(host) && isBlockedIp(host)) throw new UnsafeUrlError('That address is not publicly reachable.');
    if (!net.isIP(host) && !host.includes('.')) throw new UnsafeUrlError('Please use a full public domain name.');
  }
  u.hash = '';
  return u;
}

/** Resolve the hostname and throw if ANY resolved address is non-public (prevents DNS tricks returning mixed records). */
export async function assertPublicHost(hostname: string): Promise<string[]> {
  if (config.allowPrivateTargets) return [];
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) { if (isBlockedIp(host)) throw new UnsafeUrlError('That address is not publicly reachable.'); return [host]; }
  let addrs: { address: string }[];
  try { addrs = await lookup(host, { all: true, verbatim: true }); } catch { throw new UnsafeUrlError('We could not find that domain.'); }
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) throw new UnsafeUrlError('That address is not publicly reachable.');
  return addrs.map((a) => a.address);
}

/** fetch() that re-validates every redirect hop. */
export async function safeFetch(input: string | URL, init: RequestInit & { maxRedirects?: number; timeoutMs?: number } = {}): Promise<Response> {
  let url = parsePublicUrl(String(input));
  const max = init.maxRedirects ?? 5;
  for (let i = 0; i <= max; i++) {
    await assertPublicHost(url.hostname);
    const res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(init.timeoutMs ?? 10000), headers: { 'user-agent': 'AllyfolioBot/0.1 (+https://allyfolio.com)', ...(init.headers ?? {}) } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = parsePublicUrl(new URL(res.headers.get('location')!, url).href); continue; }
    return res;
  }
  throw new UnsafeUrlError('Too many redirects.');
}
