import '../infrastructure-safety.js';
/**
 * tests/integration/middleware.test.ts
 *
 * Verifies Section 4.6, 15.4 & 16.2: Security headers, request ID, body size limit, and content-type enforcement.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';

describe('HTTP Hardening & Security Middleware (Spec §16.2)', () => {
  const app = createApp({
    rateLimiter: new MemoryRateLimiter()
  });

  it('sets secure Helmet headers and strips X-Powered-By', async () => {
    const res = await request(app).get('/health/live');

    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'"
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('assigns X-Request-Id header when missing from request', async () => {
    const res = await request(app).get('/health/live');

    const requestId = res.headers['x-request-id'];
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe('string');
    if (typeof requestId !== 'string') throw new Error('Expected request ID string');
    expect(requestId.length).toBeGreaterThan(10);
  });

  it('preserves valid client-supplied X-Request-Id header', async () => {
    const customId = 'client-req-uuid-12345';
    const res = await request(app).get('/health/live').set('X-Request-Id', customId);

    expect(res.headers['x-request-id']).toBe(customId);
  });

  it('rejects bodies exceeding 100 KB with HTTP 413 PAYLOAD_TOO_LARGE', async () => {
    // Generate JSON body > 100 KB
    const largeObject = {
      content: 'A'.repeat(105 * 1024)
    };

    const res = await request(app)
      .post('/some-endpoint')
      .set('Content-Type', 'application/json')
      .send(largeObject);

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.error.message).toContain('100 KB');
    expect(res.body.error.requestId).toBeDefined();
  });

  it('rejects mutating requests with non-JSON Content-Type with HTTP 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(app)
      .post('/some-endpoint')
      .set('Content-Type', 'text/plain')
      .send('plain text payload');

    expect(res.status).toBe(415);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(res.body.error.message).toContain('application/json');
  });

  it('returns standard 404 NOT_FOUND envelope for non-existent routes', async () => {
    const res = await request(app).get('/api/v1/unknown-resource');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Endpoint not found');
    expect(res.body.error.requestId).toBeDefined();
  });
});
