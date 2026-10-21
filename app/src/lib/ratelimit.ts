/** Fixed-window in-memory rate limiter (single instance). Swap for Redis if you run several app instances. */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return {
    take(key: string): { ok: boolean; retryAfterS: number } {
      const t = Date.now(); let h = hits.get(key);
      if (!h || h.reset <= t) { h = { n: 0, reset: t + windowMs }; hits.set(key, h); }
      if (hits.size > 50000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      if (h.n >= limit) return { ok: false, retryAfterS: Math.ceil((h.reset - t) / 1000) };
      h.n++; return { ok: true, retryAfterS: 0 };
    },
  };
}
