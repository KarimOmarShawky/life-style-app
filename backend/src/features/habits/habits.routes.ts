/**
 * src/features/habits/habits.routes.ts
 *
 * Implements Section 14.8: Habits Routes.
 */

import { Router, type RequestHandler } from 'express';
import type { HabitsController } from './habits.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export function createHabitsRouter(options: {
  controller: HabitsController;
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

  router.use(authenticate, userRateLimiter);

  // Mount non-parameterized routes before /:id parameter match
  router.get('/progress/today', controller.getTodayProgress);
  router.get('/', controller.listHabits);
  router.post('/', controller.createHabit);

  // Checkins
  router.put('/:id/checkins/:date', controller.recordCheckin);
  router.delete('/:id/checkins/:date', controller.deleteCheckin);
  router.get('/:id/checkins', controller.getCheckins);

  // Individual habit CRUD
  router.get('/:id', controller.getHabit);
  router.patch('/:id', controller.updateHabit);
  router.delete('/:id', controller.deleteHabit);
  router.post('/:id/restore', controller.restoreHabit);

  return router;
}
