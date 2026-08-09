/**
 * Canonical host / path enforcement for static assets.
 * Runs before assets (run_worker_first) so www/http/index.html variants 301 to
 * https://secureaiframeworks.xyz/ instead of serving duplicate HTML that GSC
 * reports as "Alternate page with proper canonical tag".
 */
const CANONICAL_ORIGIN = 'https://secureaiframeworks.xyz';
const CANONICAL_HOST = 'secureaiframeworks.xyz';
const NOT_FOUND_PATHS = new Set(['/404', '/404/', '/404.html']);

interface Env {
  ASSETS: Fetcher;
}

function getCanonicalRedirect(request: Request): string | null {
  const url = new URL(request.url);
  const canonical = new URL(url.pathname + url.search, CANONICAL_ORIGIN);
  let needsRedirect = false;

  if (url.protocol === 'http:' || url.hostname.toLowerCase() === `www.${CANONICAL_HOST}`) {
    needsRedirect = true;
  }

  if (
    canonical.pathname === '/index.html' ||
    canonical.pathname === '/index.html/' ||
    canonical.pathname === '/index' ||
    canonical.pathname === '/index/' ||
    canonical.pathname === '/secureaiframeworks-xyz.html'
  ) {
    canonical.pathname = '/';
    needsRedirect = true;
  }

  if (
    !NOT_FOUND_PATHS.has(canonical.pathname) &&
    canonical.pathname !== '/' &&
    !canonical.pathname.endsWith('/') &&
    !/\.\w+$/.test(canonical.pathname)
  ) {
    canonical.pathname += '/';
    needsRedirect = true;
  }

  return needsRedirect ? canonical.toString() : null;
}

async function notFoundResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const assetResponse = await env.ASSETS.fetch(
    new Request(new URL('/404.html', url.origin), request),
  );
  return new Response(assetResponse.body, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (NOT_FOUND_PATHS.has(url.pathname)) {
      return notFoundResponse(request, env);
    }

    const redirectUrl = getCanonicalRedirect(request);
    if (redirectUrl) {
      return Response.redirect(redirectUrl, 301);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
