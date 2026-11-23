/** Marketing site only: permanent redirect from HTTP to HTTPS. Does not apply to app.allyfolio.com (Caddy). */
export function requestIsHttp(request) {
  const url = new URL(request.url);
  const visitor = request.headers.get('CF-Visitor');
  if (visitor) {
    try {
      const scheme = JSON.parse(visitor)?.scheme;
      if (scheme === 'http' || scheme === 'https') return scheme === 'http';
    } catch { /* fall through */ }
  }
  const xfp = (request.headers.get('X-Forwarded-Proto') || '').split(',')[0].trim();
  if (xfp === 'http' || xfp === 'https') return xfp === 'http';
  return url.protocol === 'http:';
}

export default {
  async fetch(request, env) {
    if (requestIsHttp(request)) {
      const url = new URL(request.url);
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
