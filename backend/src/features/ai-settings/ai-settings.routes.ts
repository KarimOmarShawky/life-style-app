/**
 * src/features/ai-settings/ai-settings.routes.ts
 *
 *   GET   /api/v1/ai/settings   (authenticated)
 *   PATCH /api/v1/ai/settings   (authenticated, strict partial body)
 *
 * 30 requests / 60 s per user; the global per-IP limit applies as well.
 * Mounted before the AI router: the settings work while the AI kill switch is
 * off and never use the chat quotas.
 */
import { Router, type RequestHandler } from 'express';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';
import { AiSettingsController } from './ai-settings.controller.js';
import type { AiSettingsService } from './ai-settings.service.js';

export const AI_SETTINGS_USER_LIMIT = 30;

export function createAiSettingsRouter(options: {
  service: AiSettingsService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const controller = new AiSettingsController(options.service);
  const userRateLimiter = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: AI_SETTINGS_USER_LIMIT,
    windowSeconds: 60,
    keyGenerator: (req) => `ai-settings:user:${req.user?.id || 'anon'}`
  });
  router.use(options.authenticate, userRateLimiter);
  router.get('/', controller.get);
  router.patch('/', controller.update);
  return router;
}
