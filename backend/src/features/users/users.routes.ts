/**
 * src/features/users/users.routes.ts
 *
 * Implements Section 14.3: User Routes with Authenticated User Rate Limiting.
 */

import { Router, type RequestHandler } from 'express';
import type { UsersController } from './users.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export interface UsersRouterOptions {
  controller: UsersController;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}

export function createUsersRouter(options: {
  controller: UsersController;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const { controller, authenticate, rateLimiter } = options;

  // Authenticated user rate limit per Section 8.3: 300 req / 60 s
  const userRateLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 300,
    windowSeconds: 60,
    keyGenerator: (req) => `user:${req.user?.id || 'anon'}`
  });

  // Expensive password checks share a bounded per-user budget across sensitive actions.
  const reauthenticationLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    failClosed: true,
    limit: 5,
    windowSeconds: 900,
    keyGenerator: (req) => `reauth:user:${req.user?.id || 'anon'}`
  });

  // Profile/export data must not be retained by shared or browser caches.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(authenticate, userRateLimiter);

  router.get('/me', controller.getProfile);
  router.patch('/me', controller.updateProfile);
  router.put('/me/devices', controller.registerPushDevice);
  router.delete('/me/devices/:deviceId', controller.deletePushDevice);
  router.post('/me/deletion', reauthenticationLimiter, controller.scheduleDeletion);
  router.delete('/me/deletion', controller.cancelDeletion);
  router.post('/me/export/archive', reauthenticationLimiter, controller.exportUserArchive);
  router.post('/me/export', reauthenticationLimiter, controller.exportUserData);

  return router;
}
