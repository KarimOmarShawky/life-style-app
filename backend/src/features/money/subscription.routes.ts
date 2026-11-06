import { Router, type RequestHandler } from 'express';
import { createRateLimitMiddleware, type RateLimiter } from '../../core/middleware/rate-limiter.js';
import type { SubscriptionController } from './subscription.controller.js';

/** Production router: subscriptions only. Payment and financial routes are retired. */
export function createSubscriptionRouter(options: {
  controller: SubscriptionController;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const { controller, authenticate, rateLimiter } = options;
  const userRateLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 300,
    windowSeconds: 60,
    keyGenerator: (req) => `user:${req.user?.id || 'anon'}`
  });
  router.use(authenticate, userRateLimiter);
  router.get('/subscriptions', controller.listSubscriptions);
  router.post('/subscriptions', controller.createSubscription);
  router.get('/subscriptions/:id', controller.getSubscription);
  router.patch('/subscriptions/:id', controller.updateSubscription);
  router.delete('/subscriptions/:id', controller.deleteSubscription);
  return router;
}
