/**
 * src/features/ai/ai.routes.ts
 *
 * Routes for the server-side AI assistant proxy:
 *   POST /api/v1/ai/chat
 *   POST /api/v1/ai/chat/stream
 *
 * Every request is authenticated, then checked against the AI kill switch
 * (disabled AI returns 503 before any quota is consumed), then charged to
 * the per-user minute and daily quotas. The daily quota degrades to a
 * bounded process-local limit when Redis is unavailable so the cost
 * control is never silently lost.
 */

import { Router, type RequestHandler } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import {
  MemoryRateLimiter,
  createRateLimitMiddleware,
  type RateLimiter
} from '../../core/middleware/rate-limiter.js';
import type { AiAssistantService } from './application/ai-assistant.service.js';
import { AiAssistantController } from './ai-assistant.controller.js';
import { AiController } from './ai.controller.js';
import type { AiService } from './ai.service.js';

export function createAiRouter(options: {
  service: AiService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
  minuteLimit: number;
  dailyLimit: number;
  /** Process-local fallback for the daily quota (bounded-fallback policy). */
  fallbackLimiter?: RateLimiter;
  /** Assistant turns with server-side context (AI-2b); same guard and quotas as /chat. */
  assistant?: AiAssistantService;
}): Router {
  const router = Router();
  const controller = new AiController(options.service);
  const fallbackLimiter = options.fallbackLimiter ?? new MemoryRateLimiter();

  const aiEnabledGuard: RequestHandler = (_req, _res, next) => {
    if (!options.service.isEnabled()) {
      return next(
        new AppError({
          httpStatus: 503,
          code: 'AI_DISABLED',
          safeMessage: 'The AI assistant is not available right now.'
        })
      );
    }
    return next();
  };

  const minuteQuota = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: options.minuteLimit,
    windowSeconds: 60,
    keyGenerator: (req) => `ai-minute:${req.user?.id || 'anon'}`,
    degradedPolicy: 'bounded-fallback',
    fallbackLimiter
  });

  const dailyQuota = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: options.dailyLimit,
    windowSeconds: 24 * 60 * 60,
    keyGenerator: (req) => `ai-day:${req.user?.id || 'anon'}`,
    degradedPolicy: 'bounded-fallback',
    fallbackLimiter
  });

  router.use(options.authenticate, aiEnabledGuard, minuteQuota, dailyQuota);
  router.post('/chat', controller.chat);
  router.post('/chat/stream', controller.chatStream);
  if (options.assistant) {
    const assistant = new AiAssistantController(options.assistant);
    router.post('/assistant/turn', assistant.turn);
    router.post('/assistant/turn/stream', assistant.turnStream);
  }

  return router;
}
