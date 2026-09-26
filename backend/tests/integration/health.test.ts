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
});
