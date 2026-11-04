/**
 * src/core/middleware/reauthentication.ts
 *
 * Shared rate limiter for high-impact authenticated identity changes: the
 * change-password endpoint and the delete-account re-authentication check.
 *
 * Both paths are security boundaries where a shared, per-account budget keeps
 * the limits and the degraded-mode behaviour consistent. The limiter is
 * deliberately fail-closed: when the shared Redis limiter is unavailable an
 * identity change must not lose its brute-force bound (F-03 / AUD-04).
 */

import type { Request, Response, NextFunction } from 'express';
import {
  createRateLimitMiddleware,
  type RateLimiter,
  type RateLimitDegradedPolicy
} from './rate-limiter.js';

export const REAUTHENTICATION_LIMIT = 5;
export const REAUTHENTICATION_WINDOW_SECONDS = 900;
export const REAUTHENTICATION_KEY_PREFIX = 'reauth:user:';

export interface ReauthenticationLimiterOptions {
  limiter: RateLimiter;
  /**
   * Process-local limiter used when the shared limiter is unavailable. Pass the
   * same bounded fallback instance the auth routers use so the degraded quota
   * is shared across the auth namespace.
   */
  fallbackLimiter?: RateLimiter | undefined;
  /** Defaults to `fail-closed`: identity changes never fail open. */
  degradedPolicy?: RateLimitDegradedPolicy | undefined;
}

/**
 * Builds the shared re-authentication rate limiter. The key is the authenticated
 * actor id, so each account gets its own budget and one account's attempts can
 * never consume another's (no cross-account interference).
 */
export function createReauthenticationLimiter(
  options: ReauthenticationLimiterOptions
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return createRateLimitMiddleware({
    limiter: options.limiter,
    limit: REAUTHENTICATION_LIMIT,
    windowSeconds: REAUTHENTICATION_WINDOW_SECONDS,
    keyGenerator: (req: Request) => {
      const actorId = req.user?.id;
      return actorId
        ? `${REAUTHENTICATION_KEY_PREFIX}${actorId}`
        : `${REAUTHENTICATION_KEY_PREFIX}unknown`;
    },
    degradedPolicy: options.degradedPolicy ?? 'fail-closed',
    fallbackLimiter: options.fallbackLimiter
  });
}
