/**
 * src/features/ai-memories/ai-memories.routes.ts
 *
 *   GET    /api/v1/ai/memories?status=active|pending  (authenticated)
 *   POST   /api/v1/ai/memories                        (authenticated, strict body)
 *   DELETE /api/v1/ai/memories                        (authenticated; all of them)
 *   PATCH  /api/v1/ai/memories/:id                    (authenticated, strict body)
 *   DELETE /api/v1/ai/memories/:id                    (authenticated)
 *
 * 30 requests / 60 s per user; the global per-IP limit applies as well.
 * Mounted before the AI router: memory can be reviewed and deleted while the
 * AI kill switch is off, and it never uses the chat quotas. Another
 * account's id answers 404, like a missing one.
 */
import { Router, type RequestHandler } from 'express';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';
import { AiMemoriesController } from './ai-memories.controller.js';
import type { AiMemoriesService } from './ai-memories.service.js';

export const AI_MEMORIES_USER_LIMIT = 30;

export function createAiMemoriesRouter(options: {
  service: AiMemoriesService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const controller = new AiMemoriesController(options.service);
  const userRateLimiter = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: AI_MEMORIES_USER_LIMIT,
    windowSeconds: 60,
    keyGenerator: (req) => `ai-memories:user:${req.user?.id || 'anon'}`
  });
  router.use(options.authenticate, userRateLimiter);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.delete('/', controller.removeAll);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}
