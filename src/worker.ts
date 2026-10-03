/**
 * Canonical host / path enforcement + security & cache headers for static assets.
 * Runs before assets (run_worker_first) so www/http/index.html variants 301 to
 * https://secureaiframeworks.xyz/ instead of serving duplicate HTML that GSC
 * reports as "Alternate page with proper canonical tag".
 *
 * Stays within the Cloudflare Workers & Pages free plan: no KV/D1/R2 bindings,
 * static-asset serving only.
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

function applySecurityHeaders(res: Response, url: URL): Response {
  const headers = new Headers(res.headers);
  // Baseline hardening (free-plan friendly, no CSP breakage for inline Astro scripts:
  // inline scripts are same-origin; external limited to fonts + images + CF beacon).
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  if (url.protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://imagedelivery.net",
      "connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self' mailto:",
    ].join('; '),
  );
  // Long-cache immutable build assets for <2s repeat visits on cellular.
  if (url.pathname.startsWith('/_astro/')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (/\.(svg|ico|png|jpg|jpeg|webp|avif|css|js)$/.test(url.pathname)) {
    headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
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
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
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

    const assetResponse = await env.ASSETS.fetch(request);
    // Preserve noindex on 404-family responses; otherwise decorate with hardening.
    if (assetResponse.status === 404) {
      return notFoundResponse(request, env);
    }
    return applySecurityHeaders(assetResponse, url);
  },
} satisfies ExportedHandler<Env>;
