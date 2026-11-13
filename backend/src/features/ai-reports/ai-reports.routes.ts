/**
 * src/features/ai-reports/ai-reports.routes.ts
 *
 *   POST /api/v1/ai/reports   (authenticated; 10 per hour and 30 per day per user)
 *
 * Mounted before the AI assistant router and outside its kill switch, so a
 * user can still report an earlier reply while AI is switched off. The
 * limits degrade to a bounded process-local limit when Redis is unavailable.
 */

import { Router, type RequestHandler } from 'express';
import {
  MemoryRateLimiter,
  createRateLimitMiddleware,
  type RateLimiter
} from '../../core/middleware/rate-limiter.js';
import { AiReportsController } from './ai-reports.controller.js';
import type { AiReportsService } from './ai-reports.service.js';

export const AI_REPORTS_HOURLY_LIMIT = 10;
export const AI_REPORTS_DAILY_LIMIT = 30;

export function createAiReportsRouter(options: {
  service: AiReportsService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
  /** Process-local fallback for the limits (bounded-fallback policy). */
  fallbackLimiter?: RateLimiter;
}): Router {
  const router = Router();
  const controller = new AiReportsController(options.service);
  const fallbackLimiter = options.fallbackLimiter ?? new MemoryRateLimiter();

  const hourlyLimit = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: AI_REPORTS_HOURLY_LIMIT,
    windowSeconds: 60 * 60,
    keyGenerator: (req) => `ai-reports-hour:${req.user?.id || 'anon'}`,
    degradedPolicy: 'bounded-fallback',
    fallbackLimiter
  });

  const dailyLimit = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: AI_REPORTS_DAILY_LIMIT,
    windowSeconds: 24 * 60 * 60,
    keyGenerator: (req) => `ai-reports-day:${req.user?.id || 'anon'}`,
    degradedPolicy: 'bounded-fallback',
    fallbackLimiter
  });

  // Middleware is attached to the route only: other methods fall through to
  // the AI router untouched.
  router.post('/', options.authenticate, hourlyLimit, dailyLimit, controller.create);

  return router;
}
