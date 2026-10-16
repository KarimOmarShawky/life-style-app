import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Redis } from 'ioredis';
import {
  MemoryRateLimiter,
  RedisRateLimiter,
  createRateLimitMiddleware
} from '../../src/core/middleware/rate-limiter.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { logger } from '../../src/core/logger/logger.js';

function redisFixture(result: unknown = [1, 60], fails = false) {
  const evalScript = vi.fn(async () => {
    if (fails) throw new Error('redis://user:provider-password@private-host');
    return result;
  });
  const limiter = new RedisRateLimiter({ eval: evalScript } as unknown as Redis);
  return { limiter, evalScript };
}

function app(failClosed: boolean) {
  const { limiter } = redisFixture(null, true);
  const handler = vi.fn((_req: express.Request, res: express.Response) => res.json({ ok: true }));
  const server = express();
  server.get(
    '/',
    createRateLimitMiddleware({
      limiter,
      limit: 5,
      windowSeconds: 900,
      keyGenerator: () => 'test-user',
      failClosed
    }),
    handler
  );
  server.use(globalErrorHandler);
  return { server, handler };
}

afterEach(() => vi.restoreAllMocks());

describe('Rate limiter boundaries and outage policy', () => {
  it('allows exactly the configured memory quota', async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 1; i <= 3; i++) {
      expect(await limiter.consume('key', 3, 60)).toMatchObject({
        allowed: true,
        remaining: 3 - i
      });
    }
    expect(await limiter.consume('key', 3, 60)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('starts a new window at the exact expiry boundary', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const limiter = new MemoryRateLimiter();
    await limiter.consume('key', 1, 1);
    clock.mockReturnValue(2000);
    expect(await limiter.consume('key', 1, 1)).toMatchObject({ allowed: true, resetSeconds: 1 });
  });

  it('isolates keys and clear resets memory quotas', async () => {
    const limiter = new MemoryRateLimiter();
    await limiter.consume('first', 1, 60);
    expect((await limiter.consume('second', 1, 60)).allowed).toBe(true);
    limiter.clear();
    expect((await limiter.consume('first', 1, 60)).allowed).toBe(true);
  });

  it('uses one Lua operation for increment/TTL/expiry and reports quota', async () => {
    const { limiter, evalScript } = redisFixture([3, 47]);
    expect(await limiter.consume('key', 5, 60)).toEqual({
      allowed: true,
      remaining: 2,
      resetSeconds: 47
    });
    expect(evalScript).toHaveBeenCalledOnce();
    expect(evalScript).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('EXPIRE'"),
      1,
      'ratelimit:key',
      60
    );
  });

  it('denies exceeded Redis quota and treats near-expiry TTL as one second', async () => {
    const { limiter } = redisFixture([6, 0]);
    expect(await limiter.consume('key', 5, 900)).toEqual({
      allowed: false,
      remaining: 0,
      resetSeconds: 1
    });
  });

  it('flags malformed Redis responses unavailable instead of trusting guessed counters', async () => {
    for (const result of [null, [], [1], [0, 30], [NaN, 30], [1, -1], [Infinity, 1], [1, 1, 1]]) {
      expect(await redisFixture(result).limiter.consume('key', 5, 60)).toMatchObject({
        unavailable: true
      });
    }
  });

  it('does not log provider errors or connection secrets on outage', async () => {
    const warning = vi.spyOn(logger, 'warn');
    expect(await redisFixture(null, true).limiter.consume('key', 5, 60)).toMatchObject({
      unavailable: true
    });
    expect(warning).toHaveBeenCalledWith('Redis rate limiter unavailable', { backend: 'redis' });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('provider-password');
  });

  it('sensitive middleware fails closed with 503 before reaching the handler', async () => {
    const { server, handler } = app(true);
    const response = await request(server).get('/');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(handler).not.toHaveBeenCalled();
    expect(response.text).not.toContain('provider-password');
  });

  it('preserves the existing general availability policy unless explicitly opted in', async () => {
    const { server, handler } = app(false);
    expect((await request(server).get('/')).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
