/**
 * src/features/tasks/tasks.routes.ts
 *
 * Implements Section 14.4: Tasks Routes.
 */

import { Router, type RequestHandler } from 'express';
import type { TasksController } from './tasks.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export function createTasksRouter(options: {
  controller: TasksController;
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

  router.get('/', controller.listTasks);
  router.post('/', controller.createTask);
  router.get('/:id', controller.getTask);
  router.patch('/:id', controller.updateTask);
  router.delete('/:id', controller.deleteTask);
  router.post('/:id/restore', controller.restoreTask);

  return router;
}
