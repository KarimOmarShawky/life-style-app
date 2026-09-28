/**
 * src/features/timer-sessions/timer-sessions.routes.ts
 *
 * Implements Section 14.7: Timer Sessions Routes.
 */

import { Router, type RequestHandler } from 'express';
import type { TimerSessionsController } from './timer-sessions.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export function createTimerSessionsRouter(options: {
  controller: TimerSessionsController;
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

  router.get('/active', controller.getActiveTimer);
  router.get('/', controller.listTimerSessions);
  router.post('/', controller.startTimer);
  router.post('/:id/stop', controller.stopTimer);
  router.delete('/:id', controller.deleteTimerSession);

  return router;
}
