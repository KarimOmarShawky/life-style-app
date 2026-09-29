/**
 * Security suite: production security headers (CSP nonce, framing, etc.).
 */

import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

async function loadMiddleware() {
  vi.resetModules();
  const mod = await import('@/middleware');
  return mod;
}

function extractNonce(csp: string | null): string | null {
  if (!csp) return null;
  return /'nonce-([^']+)'/.exec(csp)?.[1] ?? null;
}

describe('middleware security headers', () => {
  it('sets the required CSP directives with a per-request nonce', async () => {
    const { middleware } = await loadMiddleware();
    const request = new NextRequest('https://app.test/tasks');
    const response = middleware(request);
    const csp = response.headers.get('Content-Security-Policy') ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(extractNonce(csp)).toBeTruthy();
  });

  it('sets framing, sniffing, referrer and permissions headers', async () => {
    const { middleware } = await loadMiddleware();
    const response = middleware(new NextRequest('https://app.test/login'));
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
  });

  it('varies the CSP nonce per request (x-nonce forwarding is proven by the e2e smoke)', async () => {
    const { middleware } = await loadMiddleware();
    const a = middleware(new NextRequest('https://app.test/'));
    const b = middleware(new NextRequest('https://app.test/'));
    const cspNonce = extractNonce(a.headers.get('Content-Security-Policy'));
    expect(cspNonce).toBeTruthy();

    const cspB = extractNonce(b.headers.get('Content-Security-Policy'));
    expect(cspB).toBeTruthy();
    expect(cspB).not.toBe(cspNonce);
  });

  it('only attaches HSTS in production over HTTPS', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { middleware } = await loadMiddleware();
    const httpsReq = new NextRequest('https://app.test/', {
      headers: { 'x-forwarded-proto': 'https' }
    });
    const response = middleware(httpsReq);
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');

    const httpReq = new NextRequest('http://app.test/', {
      headers: { 'x-forwarded-proto': 'http' }
    });
    const httpRes = middleware(httpReq);
    expect(httpRes.headers.get('Strict-Transport-Security')).toBeNull();
    vi.unstubAllEnvs();
  });

  it('matcher skips static assets but covers app routes', async () => {
    const { config } = await loadMiddleware();
    const matcher = (config as { matcher: string[] }).matcher[0] as string;
    expect(matcher).toBe('/((?!_next/static|_next/image|favicon.ico).*)');
    // The negative lookahead excludes Next internals, not app paths.
    expect(matcher).toContain('_next/static');
    expect(matcher).not.toContain('tasks');
  });
});
