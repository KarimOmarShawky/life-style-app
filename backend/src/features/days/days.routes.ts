/**
 * src/features/days/days.routes.ts
 *
 * Routes for the Daily Plan (Section 14, P1-05):
 *   GET /api/v1/days/today
 *   GET /api/v1/days/{date}
 */

import { Router, type RequestHandler } from 'express';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';
import type { DaysService } from './days.service.js';
import { DaysController } from './days.controller.js';

export function createDaysRouter(options: {
  service: DaysService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const controller = new DaysController(options.service);

  const userRateLimiter = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: 300,
    windowSeconds: 60,
    keyGenerator: (req) => `user:${req.user?.id || 'anon'}`
  });

  router.use(options.authenticate, userRateLimiter);
  router.get('/today', controller.getToday);
  router.get('/:date', controller.getDay);

  return router;
}
