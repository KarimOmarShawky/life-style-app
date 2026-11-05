import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createIngestRouter } from '../../src/features/ingest/ingest.routes.js';
import { createMoneyRouter } from '../../src/features/money/money.routes.js';
import type { IngestController } from '../../src/features/ingest/ingest.controller.js';
import type { MoneyController } from '../../src/features/money/money.controller.js';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';
import { AppError } from '../../src/core/errors/app-error.js';

const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const different = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function setup() {
  const app = express();
  app.use(express.json());
  const auth: RequestHandler = (req, _res, next) => {
    req.user = { id: account } as NonNullable<typeof req.user>;
    next();
  };
  const analyze = vi.fn((_req, res) => res.json({ ok: true }));
  const create = vi.fn((_req, res) => res.status(201).json({ ok: true }));
  const noop: RequestHandler = (_req, res) => {
    res.status(204).end();
  };
  const controller = {
    issueToken: noop,
    revokeToken: noop,
    analyzeSms: analyze
  } as unknown as IngestController;
  const money = new Proxy(
    {},
    { get: (_target, key) => (key === 'createTransaction' ? create : noop) }
  ) as MoneyController;
  app.use(
    '/ingest',
    createIngestRouter({
      controller,
      authenticate: auth,
      authenticateIngest: auth,
      authenticateIngestOrUser: auth,
      createTransaction: create,
      rateLimiter: new MemoryRateLimiter()
    })
  );
  app.use(
    '/money',
    createMoneyRouter({
      controller: money,
      authenticate: auth,
      rateLimiter: new MemoryRateLimiter()
    })
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

describe('strict wallet routes require an owner precondition', () => {
  it.each([
    '/ingest/wallet/transactions',
    '/ingest/wallet/sms/analyze',
    '/money/wallet/transactions'
  ])('refuses missing, malformed, or different-owner headers before %s runs', async (path) => {
    const { app, analyze, create } = setup();
    const missing = await request(app).post(path).send({});
    expect(missing.status).toBe(428);
    expect(missing.headers['cache-control']).toContain('no-store');
    expect(missing.body.code).toBe('WALLET_OWNER_MISMATCH');
    for (const owner of ['', 'not-a-uuid', different, `${account},${account}`]) {
      const denied = await request(app).post(path).set('X-Wallet-Owner', owner).send({});
      expect(denied.status).toBe(428);
      expect(denied.headers['cache-control']).toContain('no-store');
      expect(denied.body.code).toBe('WALLET_OWNER_MISMATCH');
    }
    expect(analyze).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it.each([
    '/ingest/wallet/transactions',
    '/ingest/wallet/sms/analyze',
    '/money/wallet/transactions'
  ])('allows the matching authenticated owner on %s', async (path) => {
    const { app, analyze, create } = setup();
    const result = await request(app)
      .post(path)
      .set('X-Wallet-Owner', account.toUpperCase())
      .send({});
    expect(result.status).toBeLessThan(300);
    expect(analyze.mock.calls.length + create.mock.calls.length).toBe(1);
  });
});
