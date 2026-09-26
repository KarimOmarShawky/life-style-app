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
      // Pipeline INCR and TTL
      const results = await this.redis.pipeline().incr(redisKey).ttl(redisKey).exec();

      if (!results || results.length < 2) {
        throw new Error('Redis pipeline execution failed');
      }

      const incrErr = results[0]?.[0];
      const count = Number(results[0]?.[1] ?? 1);
      const ttlErr = results[1]?.[0];
      let ttl = Number(results[1]?.[1] ?? -1);

      if (incrErr || ttlErr) {
        throw incrErr || ttlErr;
      }

      // If key is new or without expiration, set TTL
      if (ttl < 0) {
        await this.redis.expire(redisKey, windowSeconds);
        ttl = windowSeconds;
      }

      const allowed = count <= limit;
      const remaining = Math.max(0, limit - count);

      return {
        allowed,
        remaining,
        resetSeconds: ttl > 0 ? ttl : windowSeconds
      };
    } catch (err) {
      // Log failure and fail open for availability, per Section 12.2 / A-17
      logger.warn('Redis rate limiter encountered error, failing open', { err: String(err), key });
      return {
        allowed: true,
        remaining: 1,
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

    if (!entry || now > entry.expiresAt) {
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
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = options.keyGenerator(req);
      const result = await options.limiter.consume(key, options.limit, options.windowSeconds);

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
