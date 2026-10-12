/**
 * src/features/search/search.routes.ts
 *
 * Routes for Global Search (Section 14, P1-05):
 *   GET /api/v1/search?q=...
 */

import { Router, type RequestHandler } from 'express';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';
import type { SearchService } from './search.service.js';
import { SearchController } from './search.controller.js';

export function createSearchRouter(options: {
  service: SearchService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const controller = new SearchController(options.service);

  const userRateLimiter = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: 300,
    windowSeconds: 60,
    keyGenerator: (req) => `user:${req.user?.id || 'anon'}`
  });

  router.use(options.authenticate, userRateLimiter);
  router.get('/', controller.search);

  return router;
}
