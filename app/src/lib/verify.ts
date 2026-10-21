import { resolveTxt } from 'node:dns/promises';
import { safeFetch } from './ssrf.ts';
export const TXT_PREFIX = 'allyfolio-verification=';
export const META_NAME = 'allyfolio-verification';
/** Ownership check: DNS TXT record on the host (or its apex) or a <meta> tag on the home page. */
export async function verifySite(origin: string, token: string): Promise<'dns' | 'meta' | null> {
  const host = new URL(origin).hostname;
  const candidates = [host, host.replace(/^www\./, '')];
  for (const h of new Set(candidates)) {
    try { const recs = await resolveTxt(h); if (recs.some((r) => r.join('') === TXT_PREFIX + token)) return 'dns'; } catch {}
  }
  try {
    const res = await safeFetch(origin + '/', { timeoutMs: 10000 });
    const body = (await res.text()).slice(0, 500_000);
    const re = new RegExp(`<meta[^>]+name=["']${META_NAME}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${META_NAME}["']`, 'i');
    const m = body.match(re); if (m && (m[1] ?? m[2]) === token) return 'meta';
  } catch {}
  return null;
}
