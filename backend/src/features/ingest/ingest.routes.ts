/**
 * src/features/ingest/ingest.routes.ts
 *
 * Token management uses the normal access token. The transaction route accepts only an ingest
 * token, so a leaked ingest token cannot read or change anything except creating transactions.
 * The SMS analyze route (the Gemini fallback) accepts an ingest token or an access token, but it
 * stores nothing: it only returns a strict, sanitized parse for the phone to act on.
 */

import { Router, type RequestHandler } from 'express';
import type { IngestController } from './ingest.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export function createIngestRouter(options: {
  controller: IngestController;
  authenticate: RequestHandler;
  authenticateIngest: RequestHandler;
  authenticateIngestOrUser: RequestHandler;
  createTransaction: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const {
    controller,
    authenticate,
    authenticateIngest,
    authenticateIngestOrUser,
    createTransaction,
    rateLimiter
  } = options;

  const tokenRateLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 20,
    windowSeconds: 60,
    keyGenerator: (req) => `ingest-token:user:${req.user?.id || 'anon'}`
  });

  const transactionRateLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 120,
    windowSeconds: 60,
    keyGenerator: (req) => `ingest-transactions:user:${req.user?.id || 'anon'}`
  });

  // The fallback consults a paid model, so it gets its own budget.
  const analyzeRateLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 60,
    windowSeconds: 60,
    keyGenerator: (req) => `ingest-sms-analyze:user:${req.user?.id || 'anon'}`
  });

  router.post('/token', authenticate, tokenRateLimiter, controller.issueToken);
  router.delete('/token', authenticate, controller.revokeToken);
  router.post('/transactions', authenticateIngest, transactionRateLimiter, createTransaction);
  router.post('/sms/analyze', authenticateIngestOrUser, analyzeRateLimiter, controller.analyzeSms);

  return router;
}
