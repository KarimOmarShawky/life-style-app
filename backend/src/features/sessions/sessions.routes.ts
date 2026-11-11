/**
 * src/features/sessions/sessions.routes.ts
 *
 *   GET  /api/v1/sessions              (authenticated)
 *   POST /api/v1/sessions/:id/revoke   (authenticated, current password)
 *
 * Feature guide G6 (ADR-047). 30 requests / 60 s per user on both routes.
 * Revoking also spends the shared, fail-closed re-authentication budget
 * (5 per 15 minutes per account, together with change-password, account
 * deletion and export). Responses are never cached.
 */

import { Router, type RequestHandler } from 'express';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';
import { createReauthenticationLimiter } from '../../core/middleware/reauthentication.js';
import { SessionsController } from './sessions.controller.js';
import type { SessionsService } from './sessions.service.js';

export const SESSIONS_USER_LIMIT = 30;

export function createSessionsRouter(options: {
  service: SessionsService;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const controller = new SessionsController(options.service);

  const userRateLimiter = createRateLimitMiddleware({
    limiter: options.rateLimiter,
    limit: SESSIONS_USER_LIMIT,
    windowSeconds: 60,
    keyGenerator: (req) => `sessions:user:${req.user?.id || 'anon'}`
  });
  const reauthenticationLimiter = createReauthenticationLimiter({
    limiter: options.rateLimiter
  });

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(options.authenticate, userRateLimiter);
  router.get('/', controller.list);
  router.post('/:id/revoke', controller.validateRevoke, reauthenticationLimiter, controller.revoke);

  return router;
}
