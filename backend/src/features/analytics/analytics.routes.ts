/**
 * src/features/analytics/analytics.routes.ts
 *
 * Routes for range-based real analytics:
 *   GET /api/v1/analytics?days=7|30|90|365
 */

import { Router, type RequestHandler } from 'express';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';
import type { AnalyticsService } from './analytics.service.js';
import { AnalyticsController } from './analytics.controller.js';

export function createAnalyticsRouter(options: {
  service: AnalyticsService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const controller = new AnalyticsController(options.service);

  const userRateLimiter = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: 120,
    windowSeconds: 60,
    keyGenerator: (req) => `user:${req.user?.id || 'anon'}`
  });

  router.use(options.authenticate, userRateLimiter);
  router.get('/', controller.getSummary);

  return router;
}
