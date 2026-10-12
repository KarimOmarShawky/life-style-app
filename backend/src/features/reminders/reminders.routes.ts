/**
 * src/features/reminders/reminders.routes.ts
 *
 * Implements Section 14.13 & FR-REM-01..06: Unified Reminders routes.
 * One factory router is mounted under each parent resource:
 *   /api/v1/tasks/:id/reminders
 *   /api/v1/habits/:id/reminders
 *   /api/v1/events/:id/reminders        (calendar keeps its own routes too)
 *   /api/v1/subscriptions/:id/reminders
 * plus the unified listing at /api/v1/reminders.
 */

import { Router, type RequestHandler } from 'express';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';
import type { ReminderParentKind } from './reminders.types.js';
import { RemindersController, UnifiedRemindersController } from './reminders.controller.js';
import type { RemindersService } from './reminders.service.js';

export function createEntityRemindersRouter(options: {
  parentKind: ReminderParentKind;
  service: RemindersService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const { parentKind, service, authenticate, rateLimiter } = options;
  const controller = new RemindersController(service, parentKind);
  const router = Router({ mergeParams: true });

  const userRateLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 300,
    windowSeconds: 60,
    keyGenerator: (req) => `user:${req.user?.id || 'anon'}`
  });

  router.use(authenticate, userRateLimiter);

  router.get('/', controller.listReminders);
  router.post('/', controller.addReminder);
  router.delete('/:reminderId', controller.deleteReminder);

  return router;
}

export function createUnifiedRemindersRouter(options: {
  service: RemindersService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const { service, authenticate, rateLimiter } = options;
  const controller = new UnifiedRemindersController(service);
  const router = Router();

  const userRateLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 300,
    windowSeconds: 60,
    keyGenerator: (req) => `user:${req.user?.id || 'anon'}`
  });

  router.use(authenticate, userRateLimiter);
  router.get('/', controller.listAll);

  return router;
}
