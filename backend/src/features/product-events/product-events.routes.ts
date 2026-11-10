/**
 * src/features/product-events/product-events.routes.ts
 *
 *   POST /api/v1/product-events   (authenticated, 60 requests / 60 s per user)
 *
 * The global per-IP limit (120 / 60 s) applies as well.
 */

import { Router, type RequestHandler } from 'express';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';
import { ProductEventsController } from './product-events.controller.js';
import type { ProductEventsService } from './product-events.service.js';

export const PRODUCT_EVENTS_USER_LIMIT = 60;

export function createProductEventsRouter(options: {
  service: ProductEventsService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const controller = new ProductEventsController(options.service);

  const userRateLimiter = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: PRODUCT_EVENTS_USER_LIMIT,
    windowSeconds: 60,
    keyGenerator: (req) => `product-events:user:${req.user?.id || 'anon'}`
  });

  router.use(options.authenticate, userRateLimiter);
  router.post('/', controller.record);

  return router;
}
