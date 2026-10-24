/**
 * src/features/dashboard/dashboard.routes.ts
 *
 * Routes for the Dashboard (Section 14, P1-05):
 *   GET /api/v1/dashboard (locked-specification path)
 */

import { Router, type RequestHandler } from 'express';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';
import type { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';

export function createDashboardRouter(options: {
  service: DashboardService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const controller = new DashboardController(options.service);

  const userRateLimiter = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: 300,
    windowSeconds: 60,
    keyGenerator: (req) => `user:${req.user?.id || 'anon'}`
  });

  router.use(options.authenticate, userRateLimiter);
  router.get('/', controller.getOverview);

  return router;
}
