/**
 * src/features/notifications/notification-preferences.routes.ts
 *
 *   GET /api/v1/notification-preferences   (authenticated)
 *   PUT /api/v1/notification-preferences   (authenticated, strict body)
 *
 * 30 requests / 60 s per user; the global per-IP limit applies as well.
 */

import { Router, type RequestHandler } from 'express';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';
import { NotificationPreferencesController } from './notification-preferences.controller.js';
import type { NotificationPreferencesService } from './notification-preferences.service.js';

export const NOTIFICATION_PREFERENCES_USER_LIMIT = 30;

export function createNotificationPreferencesRouter(options: {
  service: NotificationPreferencesService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const controller = new NotificationPreferencesController(options.service);

  const userRateLimiter = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: NOTIFICATION_PREFERENCES_USER_LIMIT,
    windowSeconds: 60,
    keyGenerator: (req) => `notification-preferences:user:${req.user?.id || 'anon'}`
  });

  router.use(options.authenticate, userRateLimiter);
  router.get('/', controller.get);
  router.put('/', controller.replace);

  return router;
}
