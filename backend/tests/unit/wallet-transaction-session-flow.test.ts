import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createIngestRouter } from '../../src/features/ingest/ingest.routes.js';
import { createMoneyRouter } from '../../src/features/money/money.routes.js';
import type { IngestController } from '../../src/features/ingest/ingest.controller.js';
import { MoneyController } from '../../src/features/money/money.controller.js';
import { MoneyService } from '../../src/features/money/money.service.js';
import type { MoneyRepository } from '../../src/features/money/money.repository.js';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ingestTokenId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const idempotencyKey = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('strict wallet session identity flows to the transaction repository', () => {
  it.each([
    ['/ingest/wallet/transactions', { sessionId, ingestTokenId }],
    ['/money/wallet/transactions', { sessionId }],
    ['/ingest/transactions', undefined],
    ['/money/transactions', undefined]
  ] as const)('passes the expected fence for %s', async (path, expected) => {
    const create = vi.fn(async () => {
      throw new Error('synthetic repository boundary');
    });
    const repository = {
      findTransactionByIdempotencyKey: vi.fn(async () => null),
      countActiveTransactions: vi.fn(async () => 0),
      createTransaction: create
    } as unknown as MoneyRepository;
    const controller = new MoneyController(
      new MoneyService(repository, { cancelPendingFor: async () => undefined } as never)
    );
    const auth: RequestHandler = (req, _res, next) => {
      req.user = { id: owner, timezone: 'UTC' } as NonNullable<typeof req.user>;
      req.sessionId = sessionId;
      req.ingestTokenId = ingestTokenId;
      next();
    };
    const noop: RequestHandler = (_req, res) => {
      res.status(204).end();
    };
    const app = express();
    app.use(express.json());
    app.use(
      '/money',
      createMoneyRouter({ controller, authenticate: auth, rateLimiter: new MemoryRateLimiter() })
    );
    app.use(
      '/ingest',
      createIngestRouter({
        controller: {
          issueToken: noop,
          revokeToken: noop,
          analyzeSms: noop
        } as unknown as IngestController,
        authenticate: auth,
        authenticateIngest: auth,
        authenticateIngestOrUser: auth,
        createTransaction: controller.createTransaction,
        rateLimiter: new MemoryRateLimiter()
      })
    );
    const errors: ErrorRequestHandler = (_error, _req, res, _next) => {
      res.status(500).end();
    };
    app.use(errors);

    const result = await request(app)
      .post(path)
      .set('X-Wallet-Owner', owner)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        kind: 'expense',
        amount: '10.00',
        currency: 'EGP',
        occurredOn: new Date().toISOString().slice(0, 10)
      });
    expect(result.status).toBe(500);
    expect(create).toHaveBeenCalledOnce();
    expect((create.mock.calls[0]! as unknown[])[3]).toEqual(expected);
  });
});
