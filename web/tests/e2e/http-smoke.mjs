/**
 * End-to-end HTTP smoke test.
 *
 * Builds the production app, runs it (`next start`) plus a throwaway mock
 * backend, and asserts the security-critical behaviours that unit tests cannot
 * observe over the wire:
 *
 *   1. Security headers (CSP nonce, framing, nosniff, referrer) on HTML pages.
 *   2. CSP nonce in the header matches the nonce on <script> tags (same request).
 *   3. HSTS only when the request arrived over HTTPS (x-forwarded-proto).
 *   4. `/api/v1/**` is proxied server-side to BACKEND_INTERNAL_URL (relative
 *      browser URLs only — the target host never appears in HTML/JS output).
 *   5. Non-/api/v1 paths are served by the app, unknown API prefixes are NOT proxied.
 *   6. Login page HTML contains no pre-baked tokens or backend host.
 *
 * Usage: node tests/e2e/http-smoke.mjs   (npm run e2e)
 *        SKIP_BUILD=1 npm run e2e        (reuse an existing production build;
 *                                         it must have been built WITH
 *                                         BACKEND_INTERNAL_URL set)
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP_PORT = 3210;
const MOCK_PORT = 3999;
const BASE = `http://127.0.0.1:${APP_PORT}`;

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Throwaway backend that echoes what it receives (never product data). */
const mockBackend = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ mock: true, url: req.url, method: req.method, body }));
  });
});

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 600) return;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  throw new Error(`Server at ${url} did not start in time`);
}

async function ensurePortFree() {
  try {
    await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(1500) });
    throw new Error(
      `Port ${APP_PORT} is already in use — a stale server would shadow this run; kill it first`
    );
  } catch (error) {
    if (String(error).includes('already in use')) throw error;
    /* connection refused = port is free */
  }
}

async function main() {
  let server = null;
  const cleanup = () => {
    if (server) {
      // Own process group (detached) — reap the whole npx → next → next-server
      // tree so orphaned servers can't keep serving a stale build.
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        try {
          server.kill('SIGTERM');
        } catch {
          /* already gone */
        }
      }
      const killer = setTimeout(() => {
        try {
          process.kill(-server.pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }, 2000);
      killer.unref?.();
    }
    mockBackend.close();
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));

  try {
    await new Promise((resolve, reject) => {
      mockBackend.once('error', reject);
      mockBackend.listen(MOCK_PORT, '127.0.0.1', resolve);
    });
    await ensurePortFree();

    /* Build BEFORE starting the server — `next start` reads .next at boot. */
    if (!process.env.SKIP_BUILD) {
      console.log('▸ building production bundle (BACKEND_INTERNAL_URL set)…');
      await new Promise((resolve, reject) => {
        const build = spawn('npm', ['run', 'build'], {
          cwd: WEB_ROOT,
          stdio: 'inherit',
          // rewrites() is evaluated at BUILD time — the proxy target must be set here.
          env: { ...process.env, BACKEND_INTERNAL_URL: `http://127.0.0.1:${MOCK_PORT}` }
        });
        build.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`build failed: ${code}`))
        );
      });
    }

    console.log('▸ starting production server…');
    server = spawn('npx', ['next', 'start', '-p', String(APP_PORT)], {
      cwd: WEB_ROOT,
      // Own process group so cleanup can reap the whole tree.
      detached: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        BACKEND_INTERNAL_URL: `http://127.0.0.1:${MOCK_PORT}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let serverLog = '';
    server.stdout.on('data', (d) => (serverLog += d));
    server.stderr.on('data', (d) => (serverLog += d));

    await waitForServer(`${BASE}/login`);

    /* Headers + nonce */
    console.log('▸ security headers & nonce');
    const res = await fetch(`${BASE}/login`);
    const csp = res.headers.get('content-security-policy') ?? '';
    check('CSP present', csp.length > 0);
    check("frame-ancestors 'none'", csp.includes("frame-ancestors 'none'"));
    check("object-src 'none'", csp.includes("object-src 'none'"));
    check("base-uri 'self'", csp.includes("base-uri 'self'"));
    check("connect-src 'self'", csp.includes("connect-src 'self'"));
    check('strict-dynamic', csp.includes("'strict-dynamic'"));
    check('no unsafe-eval', !csp.includes('unsafe-eval'));
    check('X-Frame-Options DENY', res.headers.get('x-frame-options') === 'DENY');
    check('nosniff', res.headers.get('x-content-type-options') === 'nosniff');
    check('no-referrer', res.headers.get('referrer-policy') === 'no-referrer');
    check(
      'permissions-policy',
      (res.headers.get('permissions-policy') ?? '').includes('camera=()')
    );
    check('no HSTS on plain HTTP', res.headers.get('strict-transport-security') === null);
    const httpsRes = await fetch(`${BASE}/login`, { headers: { 'x-forwarded-proto': 'https' } });
    check(
      'HSTS over HTTPS (via forwarded proto)',
      (httpsRes.headers.get('strict-transport-security') ?? '').includes('max-age=31536000')
    );

    const html = await res.text();
    const headerNonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    const scriptNonces = [...html.matchAll(/nonce="([^"]+)"/g)].map((m) => m[1]);
    check('HTML carries nonce attributes', scriptNonces.length > 0, `found ${scriptNonces.length}`);
    check(
      'header nonce === script nonce (same request)',
      Boolean(headerNonce) &&
        scriptNonces.length > 0 &&
        scriptNonces.every((n) => n === headerNonce),
      `header=${headerNonce} scripts=[${[...new Set(scriptNonces)].join(', ')}]`
    );

    /* Server-side rewrite */
    console.log('▸ API rewrite proxy');
    const apiRes = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.test', password: 'password123' })
    });
    const apiJson = await apiRes.json().catch(() => ({}));
    check(
      'POST /api/v1 proxied to backend',
      apiJson.mock === true && apiJson.url === '/api/v1/auth/login'
    );
    check('request body reached backend intact', String(apiJson.body ?? '').includes('x@y.test'));

    const listRes = await fetch(`${BASE}/api/v1/tasks`);
    const listJson = await listRes.json().catch(() => ({}));
    check('GET /api/v1 proxied', listJson.mock === true);

    const wrongRes = await fetch(`${BASE}/api/v2/tasks`);
    check('non-/api/v1 paths NOT proxied (404)', wrongRes.status === 404, `got ${wrongRes.status}`);

    /* Client output hygiene */
    console.log('▸ client output hygiene');
    check('backend host absent from HTML', !html.includes(`127.0.0.1:${MOCK_PORT}`));
    check('env var name absent from HTML', !html.includes('BACKEND_INTERNAL_URL'));
    check('no embedded access tokens', !html.includes('accessToken'));
    if (failures > 0 && serverLog) {
      console.log('  server log tail:\n' + serverLog.slice(-800));
    }
  } catch (error) {
    failures += 1;
    console.error('✗ smoke test crashed:', error);
  } finally {
    cleanup();
  }

  console.log(failures === 0 ? '\n✓ e2e smoke passed' : `\n✗ e2e smoke failed (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
