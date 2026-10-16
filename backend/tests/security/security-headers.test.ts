import '../infrastructure-safety.js';
/**
 * tests/security/security-headers.test.ts
 *
 * Verifies Section 16: Mobile security boundaries and information leakage protections.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';

describe('Security Architecture & Information Leakage Tests (Spec §16)', () => {
  const app = createApp({
    rateLimiter: new MemoryRateLimiter()
  });

  it('never emits Set-Cookie headers on any response (Spec §16.0, ADR-003, D-05)', async () => {
    const res = await request(app).get('/health/live');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('ensures error envelopes never leak stack traces, SQL syntax, or file paths (Spec §15.1, §16.1)', async () => {
    const res = await request(app).get('/api/v1/invalid-route-that-does-not-exist');

    const bodyString = JSON.stringify(res.body);
    expect(bodyString).not.toContain('node_modules');
    expect(bodyString).not.toContain('/home/');
    expect(bodyString).not.toContain('.ts');
    expect(bodyString).not.toContain('SELECT ');
    expect(bodyString).not.toContain('INSERT ');
    expect(bodyString).not.toContain('WHERE ');
  });

  it('verifies strict CSP header forbids all framing and script execution', async () => {
    const res = await request(app).get('/health/live');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'"
    );
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});
