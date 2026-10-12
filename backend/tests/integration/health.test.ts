/**
 * tests/integration/health.test.ts
 *
 * Verifies Section 4.8 & 14.18: Health check probes (/health/live, /health/ready).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { setDrainingStatus } from '../../src/features/health/health.routes.js';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';

describe('Health Endpoints (Spec §4.8, §14.18)', () => {
  const app = createApp({
    rateLimiter: new MemoryRateLimiter()
  });

  beforeEach(() => {
    setDrainingStatus(false);
  });

  afterEach(() => {
    setDrainingStatus(false);
  });

  it('GET /health/live returns HTTP 200 {"status":"ok"} without response envelope', async () => {
    const res = await request(app).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    // Verify unversioned raw format, no "success" envelope
    expect(res.body.success).toBeUndefined();
  });

  it('GET /health/ready returns HTTP 200 {"status":"ok"} when dependencies are reachable', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    // Verify no hostnames, versions, or sensitive data
    expect(res.body.version).toBeUndefined();
    expect(res.body.hostname).toBeUndefined();
  });

  it('GET /health/ready returns HTTP 503 {"status":"degraded"} during graceful shutdown drain', async () => {
    setDrainingStatus(true);

    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded' });
  });

  it('GET /health/migrate does not exist (regression: unauthenticated DDL endpoint removed)', async () => {
    // The migrate route ran schema DDL with the app's runtime credentials on a
    // bare GET and leaked stack traces on failure. It must stay gone; schema
    // changes run via `npm run migrate:up` as the lifestyle_migrator role only.
    const res = await request(app).get('/health/migrate');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
        requestId: expect.any(String)
      }
    });
  });

  it('no /health response leaks stack traces or raw internal error details', async () => {
    const safeMessages = new Set(['Endpoint not found']);
    for (const path of [
      '/health',
      '/health/live',
      '/health/ready',
      '/health/migrate',
      '/health/nope'
    ]) {
      const res = await request(app).get(path);
      const body = JSON.stringify(res.body);
      // No stack traces anywhere, and any error.message is a known-safe string
      // rather than a raw runtime error (the old /health/migrate echoed both).
      expect(body).not.toMatch(/"stack"/);
      expect(body).not.toMatch(/Schema ensured/);
      const errMessage = (res.body as { error?: { message?: string } })?.error?.message;
      if (errMessage !== undefined) {
        expect(safeMessages.has(errMessage)).toBe(true);
      }
    }
  });
});
