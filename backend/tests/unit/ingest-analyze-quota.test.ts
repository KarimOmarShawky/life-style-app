import { describe, expect, it, vi } from 'vitest';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { createIngestRouter } from '../../src/features/ingest/ingest.routes.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { MemoryRateLimiter, type RateLimiter } from '../../src/core/middleware/rate-limiter.js';

function build(limiter: RateLimiter) {
  const app = express();
  const auth: RequestHandler = (_req, _res, next) => next();
  const analyzer = vi.fn((_req, res) => res.status(200).json({ status: 'unrecognized' }));
  const transaction = vi.fn((_req, res) => res.status(201).end());
  app.use(
    '/ingest',
    createIngestRouter({
      controller: { analyzeSms: analyzer, issueToken: auth, revokeToken: auth } as never,
      authenticate: auth,
      authenticateIngest: auth,
      authenticateIngestOrUser: auth,
      createTransaction: transaction,
      rateLimiter: limiter
    })
  );
  app.use(globalErrorHandler);
  return { app, analyzer, transaction };
}

describe('paid SMS analyzer quota', () => {
  it('fails closed without calling the analyzer when the shared quota is unavailable', async () => {
    const limiter: RateLimiter = {
      consume: vi.fn(async () => ({
        allowed: true,
        remaining: 1,
        resetSeconds: 60,
        unavailable: true
      }))
    };
    const { app, analyzer, transaction } = build(limiter);
    const analyze = await request(app).post('/ingest/sms/analyze');
    expect(analyze.status).toBe(503);
    expect(analyze.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(analyzer).not.toHaveBeenCalled();
    // The ordinary transaction route keeps its existing availability policy.
    expect((await request(app).post('/ingest/transactions')).status).toBe(201);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('enforces the existing 60-per-minute budget on successful limiter responses', async () => {
    const { app, analyzer } = build(new MemoryRateLimiter());
    for (let i = 0; i < 60; i++)
      expect((await request(app).post('/ingest/sms/analyze')).status).toBe(200);
    const blocked = await request(app).post('/ingest/sms/analyze');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(analyzer).toHaveBeenCalledTimes(60);
  });
});
