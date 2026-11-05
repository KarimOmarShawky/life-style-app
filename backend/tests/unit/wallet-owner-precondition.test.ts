import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createIngestRouter } from '../../src/features/ingest/ingest.routes.js';
import { createMoneyRouter } from '../../src/features/money/money.routes.js';
import type { IngestController } from '../../src/features/ingest/ingest.controller.js';
import type { MoneyController } from '../../src/features/money/money.controller.js';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';
import { AppError } from '../../src/core/errors/app-error.js';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

function setup() {
  const app = express();
  app.use(express.json());
  const authenticate: RequestHandler = (req, _res, next) => {
    req.user = { id: userB } as NonNullable<typeof req.user>;
    next();
  };
  const analyze = vi.fn((_req, res) => res.json({ ok: true }));
  const create = vi.fn((_req, res) => res.status(201).json({ ok: true }));
  const noop: RequestHandler = (_req, res) => {
    res.status(204).end();
  };
  const ingest = {
    issueToken: noop,
    revokeToken: noop,
    analyzeSms: analyze
  } as unknown as IngestController;
  const money = new Proxy(
    {},
    { get: (_target, name) => (name === 'createTransaction' ? create : noop) }
  ) as MoneyController;
  app.use(
    '/ingest',
    createIngestRouter({
      controller: ingest,
      authenticate,
      authenticateIngest: authenticate,
      authenticateIngestOrUser: authenticate,
      createTransaction: create,
      rateLimiter: new MemoryRateLimiter()
    })
  );
  app.use(
    '/money',
    createMoneyRouter({ controller: money, authenticate, rateLimiter: new MemoryRateLimiter() })
  );
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.httpStatus).json({ code: error.code });
      return;
    }
    res.status(500).end();
  };
  app.use(errors);
  return { app, analyze, create };
}

describe('opt-in wallet owner precondition on authenticated routes', () => {
  it.each(['/ingest/transactions', '/ingest/sms/analyze', '/money/transactions'])(
    'rejects a mismatched or malformed owner on %s before the controller runs',
    async (path) => {
      const { app, analyze, create } = setup();
      for (const owner of [userA, '', 'invalid', `${userB},${userB}`]) {
        const response = await request(app).post(path).set('X-Wallet-Owner', owner).send({});
        expect(response.status).toBe(428);
        expect(response.body.code).toBe('WALLET_OWNER_MISMATCH');
        expect(response.headers['cache-control']).toContain('no-store');
      }
      expect(analyze).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    }
  );
  it.each(['/ingest/transactions', '/ingest/sms/analyze', '/money/transactions'])(
    'permits the matching owner and preserves legacy no-header calls on %s',
    async (path) => {
      const { app } = setup();
      expect(
        (await request(app).post(path).set('X-Wallet-Owner', userB).send({})).status
      ).toBeLessThan(300);
      expect((await request(app).post(path).send({})).status).toBeLessThan(300);
    }
  );
});
