/**
 * Rate limiting (spec section 22).
 *
 * Two tiers:
 *   - A general limit on the whole API, to blunt scraping and accidental loops.
 *   - A much stricter limit on authentication endpoints, which are the ones
 *     worth brute-forcing.
 *
 * Backed by Redis when it is configured, so the limit is shared across
 * instances. With per-process memory instead, N instances multiply every limit
 * by N, which is why `env.ts` requires REDIS_URL in production.
 *
 * Limiting is keyed on the client IP, and on authentication endpoints on the IP
 * combined with the submitted email. IP alone lets one attacker behind a shared
 * address lock out everyone else, while email alone lets a distributed attacker
 * spread attempts across addresses. Using both narrows each failure mode.
 */
import rateLimit, { type RateLimitRequestHandler, type Options } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import type { Request, Response } from 'express';

import { config, isTest } from '@/config';
import { AppError } from '@/core/errors';
import { createLogger } from '@/core/logger';
import { getRedis } from '@/infrastructure/database/redis/client';

const log = createLogger('rate-limit');

function buildStore(prefix: string): Options['store'] | undefined {
  const redis = getRedis();
  if (!redis) {
    return undefined;
  }

  return new RedisStore({
    prefix: `lifestyle:v1:ratelimit:${prefix}:`,
    sendCommand: async (...args: string[]): Promise<number | string | string[]> =>
      // ioredis types the variadic call loosely; the cast keeps the adapter
      // boundary honest without weakening the rest of the file.
      redis.call(...(args as [string, ...string[]])) as Promise<number | string | string[]>,
  });
}

function handler(req: Request, _res: Response, _next: unknown, options: Options): void {
  const retryAfterSeconds = Math.ceil(options.windowMs / 1000);

  log.warn({ ip: req.ip, path: req.path, method: req.method }, 'Rate limit exceeded');

  throw AppError.rateLimited(retryAfterSeconds);
}

interface LimiterSettings {
  readonly windowSeconds: number;
  readonly max: number;
  readonly prefix: string;
  readonly keyGenerator?: (req: Request) => string;
}

function createLimiter(settings: LimiterSettings): RateLimitRequestHandler {
  const store = buildStore(settings.prefix);

  return rateLimit({
    windowMs: settings.windowSeconds * 1000,
    // Effectively disabled under test, so a test suite's rapid requests are not
    // throttled. The dedicated rate-limit tests set their own low limits.
    limit: isTest ? 100_000 : settings.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler,
    ...(store ? { store } : {}),
    ...(settings.keyGenerator ? { keyGenerator: settings.keyGenerator } : {}),
  });
}

/** Applied to the whole API. */
export const generalLimiter = createLimiter({
  windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  prefix: 'general',
});

/**
 * Applied to login, register, refresh and password reset.
 *
 * The key mixes IP with the submitted email so that neither a shared NAT address
 * nor a distributed attacker defeats the limit on its own. The email is read
 * from the body, which has already been validated and normalized by the time
 * this runs on a route that validates first.
 */
export const authLimiter = createLimiter({
  windowSeconds: config.AUTH_RATE_LIMIT_WINDOW_SECONDS,
  max: config.AUTH_RATE_LIMIT_MAX_REQUESTS,
  prefix: 'auth',
  keyGenerator: (req: Request): string => {
    const ip = req.ip ?? 'unknown';
    const body: unknown = req.body;
    const email =
      typeof body === 'object' && body !== null && 'email' in body
        ? String((body as { email: unknown }).email)
            .slice(0, 254)
            .toLowerCase()
        : '';
    return `${ip}|${email}`;
  },
});
