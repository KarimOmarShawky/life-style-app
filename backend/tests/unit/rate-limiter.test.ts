import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Redis } from 'ioredis';
import {
  MemoryRateLimiter,
  RedisRateLimiter,
  createRateLimitMiddleware,
  defaultFallbackLimit
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

describe('Redis-outage degraded policy for security-sensitive routes (F-03)', () => {
  function degradedApp(options: {
    degradedPolicy?: 'allow' | 'fail-closed' | 'bounded-fallback';
    limit?: number;
    fallbackLimit?: number;
    withFallbackLimiter?: boolean;
  }) {
    const { limiter } = redisFixture(null, true); // Redis is down for every request
    const handler = vi.fn((_req: express.Request, res: express.Response) => res.json({ ok: true }));
    const server = express();
    server.get(
      '/',
      createRateLimitMiddleware({
        limiter,
        limit: options.limit ?? 15,
        windowSeconds: 900,
        keyGenerator: () => 'login:account:user@example.com:10.0.0.1',
        degradedPolicy: options.degradedPolicy ?? 'bounded-fallback',
        fallbackLimiter:
          options.withFallbackLimiter === false ? undefined : new MemoryRateLimiter(),
        ...(options.fallbackLimit ? { fallbackLimit: options.fallbackLimit } : {})
      }),
      handler
    );
    server.use(globalErrorHandler);
    return { server, handler };
  }

  it('keeps a brute-force bound on a login route when Redis is down', async () => {
    const { server, handler } = degradedApp({ limit: 15 });
    // Degraded quota is one third of the shared quota (ceil), per process.
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await request(server).get('/'));
    }
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 429]);
    expect(handler).toHaveBeenCalledTimes(5);
    expect(results[5]!.body.error.code).toBe('RATE_LIMITED');
  });

  it('marks degraded responses and alerts without logging provider secrets', async () => {
    const warning = vi.spyOn(logger, 'warn');
    const { server } = degradedApp({ limit: 15 });
    const response = await request(server).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-degraded']).toBe('1');
    expect(warning).toHaveBeenCalledWith('Rate limit degraded to bounded local fallback', {
      path: '/',
      backend: 'memory',
      fallbackLimit: 5
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('provider-password');
  });

  it('honours an explicit tighter degraded quota', async () => {
    const { server, handler } = degradedApp({ limit: 15, fallbackLimit: 1 });
    expect((await request(server).get('/')).status).toBe(200);
    expect((await request(server).get('/')).status).toBe(429);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('fails closed when the route asks for it', async () => {
    const { server, handler } = degradedApp({ degradedPolicy: 'fail-closed' });
    const response = await request(server).get('/');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(handler).not.toHaveBeenCalled();
  });

  it('never disables the control when a fallback limiter is missing', async () => {
    const { server, handler } = degradedApp({ withFallbackLimiter: false });
    expect((await request(server).get('/')).status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });

  it('still allows ordinary routes that keep the availability policy', async () => {
    const { server, handler } = degradedApp({ degradedPolicy: 'allow' });
    for (let i = 0; i < 3; i++) {
      expect((await request(server).get('/')).status).toBe(200);
    }
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('uses the shared quota normally while Redis answers', async () => {
    const { limiter } = redisFixture([1, 60]);
    const handler = vi.fn((_req: express.Request, res: express.Response) => res.json({ ok: true }));
    const server = express();
    server.get(
      '/',
      createRateLimitMiddleware({
        limiter,
        limit: 15,
        windowSeconds: 900,
        keyGenerator: () => 'login:ip:10.0.0.1',
        degradedPolicy: 'bounded-fallback',
        fallbackLimiter: new MemoryRateLimiter()
      }),
      handler
    );
    const response = await request(server).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-remaining']).toBe('14');
    expect(response.headers['ratelimit-degraded']).toBeUndefined();
  });

  it('rejects invalid degraded bounds instead of defaulting to unbounded', () => {
    expect(() => new MemoryRateLimiter({ maxKeys: 0 })).toThrow(
      'Invalid memory rate limiter bound'
    );
    expect(defaultFallbackLimit(0)).toBe(1);
    expect(defaultFallbackLimit(15)).toBe(5);
  });
});
