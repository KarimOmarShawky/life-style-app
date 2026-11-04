/**
 * src/features/auth/auth.routes.ts
 *
 * Implements Section 14.2 & Section 8.3: Auth Routes with Route-Specific Rate Limiters.
 */

import { Router, type NextFunction, type RequestHandler } from 'express';
import type { AuthController } from './auth.controller.js';
import {
  type RateLimiter,
  MemoryRateLimiter,
  createRateLimitMiddleware
} from '../../core/middleware/rate-limiter.js';
import { createReauthenticationLimiter } from '../../core/middleware/reauthentication.js';
import { changePasswordSchema } from './auth.validation.js';

export interface AuthRouterOptions {
  controller: AuthController;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
  /**
   * Process-local limiter used when the shared Redis limiter is unavailable.
   * Authentication must keep a brute-force bound in that state instead of
   * failing open (F-03).
   */
  degradedRateLimiter?: RateLimiter;
}

export function createAuthRouter(options: {
  controller: AuthController;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
  degradedRateLimiter?: RateLimiter;
}): Router {
  const router = Router();
  const { controller, authenticate, rateLimiter } = options;
  // One shared fallback instance: every auth limiter degrades into the same
  // per-process quota for the same key namespace.
  const degradedRateLimiter = options.degradedRateLimiter ?? new MemoryRateLimiter();
  // Authentication routes never fail open on a Redis outage.
  const degraded = {
    degradedPolicy: 'bounded-fallback' as const,
    fallbackLimiter: degradedRateLimiter
  };

  // Rate Limiting per Section 8.3:
  // Register: 5 requests / 60 min by IP
  const registerLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 5,
    windowSeconds: 3600,
    keyGenerator: (req) => `register:ip:${req.ip || 'unknown'}`,
    ...degraded
  });

  // Login: 15 requests / 15 min by IP
  const loginIpLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 15,
    windowSeconds: 900,
    keyGenerator: (req) => `login:ip:${req.ip || 'unknown'}`,
    ...degraded
  });

  // Login: 5 requests / 15 min by Email + IP
  const loginAccountLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 5,
    windowSeconds: 900,
    keyGenerator: (req) => {
      const email =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'unknown';
      return `login:account:${email}:${req.ip || 'unknown'}`;
    },
    ...degraded
  });

  // Refresh: 60 requests / 60s by IP
  const refreshLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 60,
    windowSeconds: 60,
    keyGenerator: (req) => `refresh:ip:${req.ip || 'unknown'}`,
    ...degraded
  });

  // Forgot password: 5 requests / 60 min by IP
  const forgotPasswordLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 5,
    windowSeconds: 3600,
    keyGenerator: (req) => `pwforgot:ip:${req.ip || 'unknown'}`,
    ...degraded
  });

  // Forgot password: per-account issuance cap (AUD-03). The per-code OTP
  // counter is reset whenever a new code is issued, so without this an attacker
  // burning reset codes from rotating IPs could guess indefinitely for one
  // account. This bounds how many codes an account can have issued per hour.
  // The key is the email string the caller supplied (not whether the account
  // exists), so unknown and existing emails are treated alike and the cap does
  // not enable account enumeration.
  const forgotPasswordAccountLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 10,
    windowSeconds: 3600,
    keyGenerator: (req) => {
      const email = req.body?.email;
      if (typeof email !== 'string' || email.trim().length === 0) {
        return 'pwforgot:account:unknown';
      }
      return `pwforgot:account:${email.trim().toLowerCase()}`;
    },
    ...degraded
  });

  // Reset password: 10 requests / 60 min by IP
  const resetPasswordLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 10,
    windowSeconds: 3600,
    keyGenerator: (req) => `pwreset:ip:${req.ip || 'unknown'}`,
    ...degraded
  });

  // Change password: shares the authenticated re-authentication budget with
  // delete-account re-authentication (same factory, key namespace
  // `reauth:user:<id>`, and fail-closed policy, AUD-04). Validation runs BEFORE
  // the rate-limit window so a malformed body never consumes the authenticated
  // user's budget, while well-formed attempts still share the per-account limit.
  const changePasswordLimiter = createReauthenticationLimiter({
    limiter: rateLimiter
  });

  const changePasswordHandler: RequestHandler = (req, res, next) => {
    try {
      changePasswordSchema.parse(req.body);
    } catch (err) {
      next(err);
      return;
    }
    const limiterCallback: NextFunction = (err) => {
      if (err) {
        next(err);
        return;
      }
      controller.changePassword(req, res, next);
    };
    changePasswordLimiter(req, res, limiterCallback);
  };

  // Route declarations
  router.post('/register', registerLimiter, controller.register);
  router.post('/login', loginIpLimiter, loginAccountLimiter, controller.login);
  router.post('/refresh', refreshLimiter, controller.refresh);
  router.post('/logout', controller.logout);
  router.post('/logout-all', authenticate, controller.logoutAll);
  router.post(
    '/forgot-password',
    forgotPasswordLimiter,
    forgotPasswordAccountLimiter,
    controller.forgotPassword
  );
  router.post('/reset-password', resetPasswordLimiter, controller.resetPassword);
  router.post('/change-password', authenticate, changePasswordHandler);

  return router;
}
