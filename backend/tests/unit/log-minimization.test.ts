/**
 * tests/unit/log-minimization.test.ts
 *
 * V-10: throttling diagnostics and internal error logging must not write
 * account identifiers, IP-derived keys or raw database/provider values into
 * operational logs.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { correlationId, summarizeErrorForLog } from '../../src/core/logger/log-minimization.js';
import { baseLogger, logger, logProcessFailure } from '../../src/core/logger/logger.js';
import { AppError } from '../../src/core/errors/app-error.js';
import { PgAuditLogger } from '../../src/infrastructure/database/postgres/audit-logger.js';
import { PgTransactionRunner } from '../../src/infrastructure/database/postgres/transaction-runner.js';
import { createRateLimitMiddleware } from '../../src/core/middleware/rate-limiter.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';

const EMAIL = 'someone.private@example.com';
const IP = '203.0.113.42';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Log minimization (V-10)', () => {
  it('does not leak provider values from audit and after-commit failures', async () => {
    const sink = vi.spyOn(baseLogger, 'error').mockImplementation(() => undefined as never);
    const err = new Error(`secret value ${EMAIL}`);
    const audit = new PgAuditLogger({ query: vi.fn().mockRejectedValue(err) } as never);
    await audit.log({ actorType: 'system', eventType: 'test', outcome: 'failure' });
    const runner = new PgTransactionRunner({
      transaction: () => ({ execute: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) })
    } as never);
    await runner.run(async (ctx) => {
      ctx.afterCommit(() => {
        throw err;
      });
    });
    expect(sink).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sink.mock.calls)).not.toContain(EMAIL);
  });

  it('replaces a sensitive key with a keyed, non-reversible correlation id', () => {
    const key = `login:${EMAIL}:${IP}`;
    const first = correlationId(key);

    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(first).not.toContain(EMAIL);
    expect(first).not.toContain(IP);
    expect(correlationId(key)).toBe(first);
    expect(correlationId(`${key}:other`)).not.toBe(first);
  });

  it('summarizes a database error without its message, detail or values', () => {
    const error = Object.assign(
      new Error(`duplicate key value violates unique constraint: ${EMAIL} / ${IP}`),
      { code: '23505', constraint: 'users_email_key', table: 'users', detail: EMAIL }
    );
    const summary = summarizeErrorForLog(error);
    expect(summary).toMatchObject({
      errorName: 'Error',
      errorCode: '23505'
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(IP);
    expect(serialized).not.toContain('duplicate key');
  });

  it('does not trust error name, stack, constraint, table or message as log-safe', () => {
    const error = Object.assign(new Error(`first line\n${EMAIL}`), {
      name: EMAIL,
      code: '23514',
      constraint: EMAIL,
      table: EMAIL,
      detail: EMAIL
    });
    error.stack = `Error: first line\n${EMAIL}`;
    const summary = summarizeErrorForLog(error);
    expect(summary).toEqual({ errorName: 'Error', errorCode: '23514' });
    expect(JSON.stringify(summary)).not.toContain(EMAIL);
  });

  it('does not serialize a raw Error passed to error or fatal wrappers', () => {
    const errorSink = vi.spyOn(baseLogger, 'error').mockImplementation(() => undefined as never);
    const fatalSink = vi.spyOn(baseLogger, 'fatal').mockImplementation(() => undefined as never);
    const failure = new Error(`sensitive payload ${EMAIL}`);
    logger.error('safe diagnostic', failure);
    logger.fatal('safe diagnostic', failure);
    expect(errorSink).toHaveBeenCalledOnce();
    expect(fatalSink).toHaveBeenCalledOnce();
    expect(JSON.stringify([...errorSink.mock.calls, ...fatalSink.mock.calls])).not.toContain(EMAIL);
  });

  it('redacts process-failure reasons even when they are strings or arbitrary objects', () => {
    const sink = vi.spyOn(baseLogger, 'fatal').mockImplementation(() => undefined as never);
    logProcessFailure('uncaughtException', new Error(`value ${EMAIL}`));
    logProcessFailure('unhandledRejection', `value ${EMAIL}`);
    logProcessFailure('unhandledRejection', { nested: { payload: EMAIL } });
    expect(sink).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(sink.mock.calls)).not.toContain(EMAIL);
  });

  it('tolerates hostile error getters and never logs their values', () => {
    const error = new Error('not safe');
    Object.defineProperty(error, 'name', {
      get() {
        throw new Error(EMAIL);
      }
    });
    expect(summarizeErrorForLog(error)).toEqual({ errorName: 'unknown' });
  });

  it('does not log AppError messages or internal causes', async () => {
    const sink = vi.spyOn(baseLogger, 'error').mockImplementation(() => undefined as never);
    const app = express();
    app.use(() => {
      throw AppError.database(new Error(`row is ${EMAIL}`));
    });
    app.use(globalErrorHandler);
    const response = await request(app).get(`/sensitive/${EMAIL}`);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain(EMAIL);
    expect(sink).toHaveBeenCalledOnce();
    expect(JSON.stringify(sink.mock.calls)).not.toContain(EMAIL);
  });

  it('does not include a client-visible operational message in warning logs', async () => {
    const sink = vi.spyOn(baseLogger, 'warn').mockImplementation(() => undefined as never);
    const app = express();
    app.use(() => {
      throw AppError.forbidden(`sensitive ${EMAIL}`);
    });
    app.use(globalErrorHandler);
    const response = await request(app).get(`/sensitive/${EMAIL}`);
    expect(response.status).toBe(403);
    expect(sink).toHaveBeenCalledOnce();
    expect(JSON.stringify(sink.mock.calls)).not.toContain(EMAIL);
  });

  it('never logs a raw rate-limit key when a request is throttled', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const limiter = {
      consume: vi.fn(async () => ({
        allowed: false,
        remaining: 0,
        resetSeconds: 30,
        unavailable: false
      }))
    };
    const app = express();
    app.use(
      createRateLimitMiddleware({
        limiter: limiter as never,
        limit: 5,
        windowSeconds: 60,
        keyGenerator: () => `login:${EMAIL}:${IP}`
      })
    );
    app.use((_req, res) => res.status(200).json({ ok: true }));
    app.use(globalErrorHandler);

    const res = await request(app).get('/api/v1/auth/login');
    expect(res.status).toBe(429);

    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(IP);
    expect(logged).not.toContain('login:');
    expect(warn.mock.calls.some((call) => 'keyCorrelation' in (call[1] as object))).toBe(true);
  });

  it('keeps database values out of the error log and the client response', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const app = express();
    app.use(() => {
      const failure = Object.assign(new Error(`insert into users values ('${EMAIL}') failed`), {
        code: '23514',
        table: 'users'
      });
      throw failure;
    });
    app.use(globalErrorHandler);

    const res = await request(app).get(`/api/v1/users/${EMAIL}`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(EMAIL);

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('insert into users');
    expect(logged).toContain('23514');
  });

  it('masks an unexpected error message in both the log and the response', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const app = express();
    app.use(() => {
      throw new Error(`decrypt failed for ${EMAIL}`);
    });
    app.use(globalErrorHandler);

    const res = await request(app).get(`/api/v1/money/transactions/${EMAIL}`);
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Internal server error');

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('decrypt failed');
  });
});
