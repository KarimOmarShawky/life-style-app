/**
 * src/features/recurring-tasks/recurring-tasks.routes.ts
 *
 * Implements Section 14.6: Recurring Tasks Routes.
 */

import { Router, type RequestHandler } from 'express';
import type { RecurringTasksController } from './recurring-tasks.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export function createRecurringTasksRouter(options: {
  controller: RecurringTasksController;
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

  router.get('/', controller.listRecurringTasks);
  router.post('/', controller.createRecurringTask);
  router.get('/:id', controller.getRecurringTask);
  router.patch('/:id', controller.updateRecurringTask);
  router.delete('/:id', controller.deleteRecurringTask);

  return router;
}
