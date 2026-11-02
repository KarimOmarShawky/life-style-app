/**
 * tests/unit/reauthentication-limiter.test.ts
 *
 * Validates AUD-04: the shared re-authentication limiter bounds authenticated
 * identity changes (change-password and delete-account re-authentication) to a
 * per-account budget and never fails open when the shared limiter is unavailable.
 */

import { describe, it, expect, vi } from 'vitest';
import { createReauthenticationLimiter } from '../../src/core/middleware/reauthentication.js';
import { MemoryRateLimiter } from '../../src/core/middleware/rate-limiter.js';
import { AppError } from '../../src/core/errors/app-error.js';

function makeRequest(userId: string): never {
  return {
    ip: '203.0.113.10',
    user: { id: userId },
    body: {},
    path: '/api/v1/auth/change-password'
  } as never;
}

function makeResponse(): never {
  return { setHeader: vi.fn() } as never;
}

describe('shared reauthentication limiter (AUD-04)', () => {
  it('allows 5 attempts per account then rejects with RATE_LIMITED', async () => {
    const limiter = createReauthenticationLimiter({ limiter: new MemoryRateLimiter() });
    const req = makeRequest('user-1');
    const res = makeResponse();
    const next = vi.fn();

    for (let i = 0; i < 5; i += 1) {
      next.mockClear();
      await limiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeUndefined(); // allowed: no error argument
    }

    next.mockClear();
    await limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.httpStatus).toBe(429);
  });

  it('gives each account its own budget (no cross-account interference)', async () => {
    const limiter = createReauthenticationLimiter({ limiter: new MemoryRateLimiter() });
    const res = makeResponse();
    const next = vi.fn();

    // user-1 exhausts its budget.
    for (let i = 0; i < 6; i += 1) {
      next.mockClear();
      await limiter(makeRequest('user-1'), res, next);
    }

    // user-2 still gets its full budget.
    for (let i = 0; i < 5; i += 1) {
      next.mockClear();
      await limiter(makeRequest('user-2'), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeUndefined();
    }
  });

  it('fails closed (503 SERVICE_UNAVAILABLE) when the shared limiter is unavailable', async () => {
    const unavailable = {
      async consume() {
        return { allowed: true, remaining: 1, resetSeconds: 900, unavailable: true };
      }
    };
    const limiter = createReauthenticationLimiter({ limiter: unavailable as never });
    const next = vi.fn();

    await limiter(makeRequest('user-1'), makeResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.httpStatus).toBe(503);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
  });
});
