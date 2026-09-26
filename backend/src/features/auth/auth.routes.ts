/**
 * src/features/auth/auth.routes.ts
 *
 * Implements Section 14.2 & Section 8.3: Auth Routes with Route-Specific Rate Limiters.
 */

import { Router, type RequestHandler } from 'express';
import type { AuthController } from './auth.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export interface AuthRouterOptions {
  controller: AuthController;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}

export function createAuthRouter(options: {
  controller: AuthController;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const { controller, authenticate, rateLimiter } = options;

  // Rate Limiting per Section 8.3:
  // Register: 5 requests / 60 min by IP
  const registerLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 5,
    windowSeconds: 3600,
    keyGenerator: (req) => `register:ip:${req.ip || 'unknown'}`
  });

  // Login: 15 requests / 15 min by IP
  const loginIpLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 15,
    windowSeconds: 900,
    keyGenerator: (req) => `login:ip:${req.ip || 'unknown'}`
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
    }
  });

  // Refresh: 60 requests / 60s by IP
  const refreshLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 60,
    windowSeconds: 60,
    keyGenerator: (req) => `refresh:ip:${req.ip || 'unknown'}`
  });

  // Forgot password: 5 requests / 60 min by IP
  const forgotPasswordLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 5,
    windowSeconds: 3600,
    keyGenerator: (req) => `pwforgot:ip:${req.ip || 'unknown'}`
  });

  // Reset password: 10 requests / 60 min by IP
  const resetPasswordLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 10,
    windowSeconds: 3600,
    keyGenerator: (req) => `pwreset:ip:${req.ip || 'unknown'}`
  });

  // Route declarations
  router.post('/register', registerLimiter, controller.register);
  router.post('/login', loginIpLimiter, loginAccountLimiter, controller.login);
  router.post('/refresh', refreshLimiter, controller.refresh);
  router.post('/logout', controller.logout);
  router.post('/logout-all', authenticate, controller.logoutAll);
  router.post('/forgot-password', forgotPasswordLimiter, controller.forgotPassword);
  router.post('/reset-password', resetPasswordLimiter, controller.resetPassword);
  router.post('/change-password', authenticate, controller.changePassword);

  return router;
}
