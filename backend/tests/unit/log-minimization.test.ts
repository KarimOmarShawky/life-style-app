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
import { logger } from '../../src/core/logger/logger.js';
import { createRateLimitMiddleware } from '../../src/core/middleware/rate-limiter.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';

const EMAIL = 'someone.private@example.com';
const IP = '203.0.113.42';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Log minimization (V-10)', () => {
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
      errorCode: '23505',
      constraint: 'users_email_key',
      table: 'users'
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(IP);
    expect(serialized).not.toContain('duplicate key');
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

    const res = await request(app).get('/api/v1/users');
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

    const res = await request(app).get('/api/v1/money/transactions');
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Internal server error');

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('decrypt failed');
  });
});
