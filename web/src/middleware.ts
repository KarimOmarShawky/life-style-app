import { NextResponse, type NextRequest } from 'next/server';

/**
 * Production security headers.
 *
 * - CSP uses a per-request nonce with `strict-dynamic` for scripts (required
 *   by Next.js inline bootstrap scripts); no `unsafe-eval`, no wildcard
 *   sources. Styles allow `unsafe-inline` only (Next.js injects inline
 *   critical styles); styles cannot execute script.
 * - `connect-src 'self'` pins API traffic to the same-origin `/api/v1` proxy.
 * - HSTS is only attached when the request arrived over HTTPS (directly or
 *   via a trusted `x-forwarded-proto` from the deployment proxy).
 */

const isProduction = process.env.NODE_ENV === 'production';

function buildCsp(nonce: string): string {
  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self'`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `manifest-src 'self'`,
    `worker-src 'self'`,
    `frame-src 'none'`
  ];
  if (isProduction) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID();
  // Base64-encode for broader CSP parser compatibility.
  const encodedNonce = btoa(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', encodedNonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('Content-Security-Policy', buildCsp(encodedNonce));
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );

  const forwardedProto = request.headers.get('x-forwarded-proto');
  const isHttps = forwardedProto === 'https' || request.nextUrl.protocol === 'https:';
  if (isProduction && isHttps) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  return response;
}

export const config = {
  // Apply to every route except Next.js internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
