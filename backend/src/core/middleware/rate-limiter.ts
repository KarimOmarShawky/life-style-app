/**
 * src/core/middleware/rate-limiter.ts
 *
 * Implements Section 16.3 & ADR-016: Rate Limiting Architecture.
 * Provides Redis-backed sliding/fixed window rate limiting with fallback.
 *
 * Degraded-mode policy (F-03):
 *  - The general availability policy stays fail-open (`allow`) for ordinary
 *    routes: a cache outage must not take the whole product down.
 *  - Security-sensitive routes (authentication) must NOT lose brute-force
 *    protection when Redis is unavailable. They opt into either
 *    `fail-closed` (reject with 503) or `bounded-fallback` (fall back to a
 *    tightly bounded process-local quota, default one third of the Redis
 *    quota). `bounded-fallback` keeps abuse protection without making a
 *    Redis outage a full authentication outage.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';
import { AppError } from '../errors/app-error.js';
import { logger } from '../logger/logger.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
  /** Backing store failed; the degraded policy decided what happened next. */
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
      // Provider error strings may contain connection URLs/passwords: do not log them.
      // The caller (middleware) applies the route's documented degraded policy.
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

/** Bounded process-local limiter. Used as the degraded-mode fallback and in tests. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly store = new Map<string, { count: number; expiresAt: number }>();
  private readonly maxKeys: number;

  constructor(options: { maxKeys?: number } = {}) {
    this.maxKeys = options.maxKeys ?? 10_000;
    if (!Number.isInteger(this.maxKeys) || this.maxKeys < 1) {
      throw new Error('Invalid memory rate limiter bound');
    }
  }

  public async consume(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    this.evictExpired(now);
    const entry = this.store.get(key);

    if (!entry || now >= entry.expiresAt) {
      const expiresAt = now + windowSeconds * 1000;
      // Bound the map: key space is attacker-controlled (IP / email / account).
      if (!entry && this.store.size >= this.maxKeys) {
        const oldest = this.store.keys().next();
        if (!oldest.done) this.store.delete(oldest.value);
      }
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

  private evictExpired(now: number): void {
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) this.store.delete(key);
    }
  }
}

/**
 * Degraded-mode limiter: uses Redis while it answers, and falls back to a
 * bounded process-local quota when it does not. The result keeps
 * `unavailable: true` so the middleware can report and alert on degradation.
 */
export class BoundedFallbackRateLimiter implements RateLimiter {
  constructor(
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter,
    private readonly fallbackLimitFor: (limit: number) => number = defaultFallbackLimit
  ) {}

  public async consume(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const primaryResult = await this.primary.consume(key, limit, windowSeconds);
    if (!primaryResult.unavailable) return primaryResult;

    const fallbackLimit = this.fallbackLimitFor(limit);
    const fallbackResult = await this.fallback.consume(key, fallbackLimit, windowSeconds);
    return {
      ...fallbackResult,
      // Still flagged: monitoring must see that the shared quota was not used.
      unavailable: true
    };
  }
}

/**
 * Per-process degraded quota. Deliberately tighter than the Redis quota:
 * with N replicas the worst case is N x this value, so the degraded mode
 * bounds abuse without pretending to be a cluster-wide counter.
 */
export function defaultFallbackLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1) return 1;
  return Math.max(1, Math.ceil(limit / 3));
}

/**
 * - `allow`: general availability policy (Section 12.2 / A-17); a degraded
 *   limiter lets the request through.
 * - `fail-closed`: reject with 503 while the limiter is degraded.
 * - `bounded-fallback`: enforce a tighter process-local quota instead.
 */
export type RateLimitDegradedPolicy = 'allow' | 'fail-closed' | 'bounded-fallback';

export interface RateLimitOptions {
  limiter: RateLimiter;
  limit: number;
  windowSeconds: number;
  keyGenerator: (req: Request) => string;
  /**
   * What to do when the limiter reports `unavailable`. Defaults to `allow`
   * unless `failClosed` is set (kept for existing call sites).
   */
  degradedPolicy?: RateLimitDegradedPolicy | undefined;
  /** @deprecated Prefer `degradedPolicy: 'fail-closed'`. */
  failClosed?: boolean | undefined;
  /** Required by `bounded-fallback`: the process-local limiter to degrade to. */
  fallbackLimiter?: RateLimiter | undefined;
  /** Optional override for the degraded quota (defaults to one third). */
  fallbackLimit?: number | undefined;
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = options.keyGenerator(req);
      const policy: RateLimitDegradedPolicy =
        options.degradedPolicy ?? (options.failClosed ? 'fail-closed' : 'allow');
      const primary = await options.limiter.consume(key, options.limit, options.windowSeconds);

      let result = primary;
      let degraded = false;

      if (primary.unavailable) {
        if (policy === 'fail-closed') {
          return next(AppError.serviceUnavailable('Security verification temporarily unavailable'));
        }
        if (policy === 'bounded-fallback') {
          const fallbackLimit = options.fallbackLimit ?? defaultFallbackLimit(options.limit);
          if (!options.fallbackLimiter) {
            // Misconfiguration must not silently disable the control.
            logger.error('Rate limit degraded policy without a fallback limiter', {
              path: req.path
            });
            return next(
              AppError.serviceUnavailable('Security verification temporarily unavailable')
            );
          }
          result = await options.fallbackLimiter.consume(key, fallbackLimit, options.windowSeconds);
          degraded = true;
          // Alertable signal: the shared quota was not enforced for this request.
          logger.warn('Rate limit degraded to bounded local fallback', {
            path: req.path,
            backend: 'memory',
            fallbackLimit
          });
        }
      }

      res.setHeader('RateLimit-Limit', options.limit);
      res.setHeader('RateLimit-Remaining', result.remaining);
      res.setHeader('RateLimit-Reset', result.resetSeconds);
      if (degraded) {
        res.setHeader('RateLimit-Degraded', '1');
      }

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
