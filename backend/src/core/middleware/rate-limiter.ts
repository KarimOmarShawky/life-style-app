/**
 * src/core/middleware/rate-limiter.ts
 *
 * Implements Section 16.3 & ADR-016: Rate Limiting Architecture.
 * Provides Redis-backed sliding/fixed window rate limiting with fallback.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';
import { AppError } from '../errors/app-error.js';
import { logger } from '../logger/logger.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
  /** Backing store failed; default availability policy may have allowed the request. */
  unavailable?: boolean;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  public async consume(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const redisKey = `ratelimit:${key}`;
    try {
      // One atomic operation: concurrent first hits cannot extend the fixed window,
      // and a failed second network round-trip cannot leave an immortal counter.
      const result: unknown = await this.redis.eval(
        `local count = redis.call('INCR', KEYS[1])
         local ttl = redis.call('TTL', KEYS[1])
         if ttl < 0 then
           redis.call('EXPIRE', KEYS[1], ARGV[1])
           ttl = tonumber(ARGV[1])
         end
         return {count, ttl}`,
        1,
        redisKey,
        windowSeconds
      );
      if (!Array.isArray(result) || result.length !== 2) {
        throw new Error('Invalid rate limit response');
      }
      const count = Number(result[0]);
      const ttl = Number(result[1]);
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(ttl) || ttl < 0) {
        throw new Error('Invalid rate limit counters');
      }

      const allowed = count <= limit;
      const remaining = Math.max(0, limit - count);

      return {
        allowed,
        remaining,
        resetSeconds: Math.max(1, ttl)
      };
    } catch {
      // Preserve the general availability policy (Section 12.2 / A-17), while
      // allowing sensitive endpoints to explicitly reject a degraded result.
      // Provider error strings may contain connection URLs/passwords: do not log them.
      logger.warn('Redis rate limiter unavailable', { backend: 'redis' });
      return {
        allowed: true,
        remaining: 1,
        unavailable: true,
        resetSeconds: windowSeconds
      };
    }
  }
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly store = new Map<string, { count: number; expiresAt: number }>();

  public async consume(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now >= entry.expiresAt) {
      const expiresAt = now + windowSeconds * 1000;
      this.store.set(key, { count: 1, expiresAt });
      return {
        allowed: true,
        remaining: limit - 1,
        resetSeconds: windowSeconds
      };
    }

    entry.count += 1;
    const remaining = Math.max(0, limit - entry.count);
    const resetSeconds = Math.ceil((entry.expiresAt - now) / 1000);

    return {
      allowed: entry.count <= limit,
      remaining,
      resetSeconds
    };
  }

  public clear(): void {
    this.store.clear();
  }
}

export interface RateLimitOptions {
  limiter: RateLimiter;
  limit: number;
  windowSeconds: number;
  keyGenerator: (req: Request) => string;
  /** Opt-in for sensitive actions; does not alter the general fail-open policy. */
  failClosed?: boolean;
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = options.keyGenerator(req);
      const result = await options.limiter.consume(key, options.limit, options.windowSeconds);

      if (result.unavailable && options.failClosed) {
        return next(AppError.serviceUnavailable('Security verification temporarily unavailable'));
      }

      res.setHeader('RateLimit-Limit', options.limit);
      res.setHeader('RateLimit-Remaining', result.remaining);
      res.setHeader('RateLimit-Reset', result.resetSeconds);

      if (!result.allowed) {
        logger.warn(`Rate limit exceeded for key: ${key}`, {
          path: req.path,
          limit: options.limit,
          resetSeconds: result.resetSeconds
        });
        return next(AppError.rateLimited(result.resetSeconds));
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
