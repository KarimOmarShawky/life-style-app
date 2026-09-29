import type { NextConfig } from 'next';

/**
 * Next.js configuration for the LifeStyle web client.
 *
 * - `BACKEND_INTERNAL_URL` is a SERVER-ONLY environment variable (never exposed
 *   to the browser via NEXT_PUBLIC_*). Browser code only ever calls relative
 *   `/api/v1/...` same-origin URLs, which are rewritten/proxied here.
 * - The rewrite target must be a full http(s) origin reachable from the
 *   Next.js server process (service DNS name, approved internal address, or an
 *   operator-supplied local URL in `.env.local`).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    const raw = process.env.BACKEND_INTERNAL_URL;
    if (!raw || raw.trim() === '') {
      // Fail closed: without a server-side backend target the API proxy is
      // simply unavailable and browser requests will 404 (never leaking to an
      // unexpected host).
      return [];
    }
    const base = raw.trim().replace(/\/+$/, '');
    return [
      {
        source: '/api/v1/:path*',
        destination: `${base}/api/v1/:path*`
      }
    ];
  }
};

export default nextConfig;
