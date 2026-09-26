/**
 * src/features/health/health.routes.ts
 *
 * Implements Section 4.8 & 14.18: Health check endpoints.
 * Unversioned, unauthenticated, and excluded from envelope wrapping and rate limiting.
 * Returns raw JSON without leaking hostnames, software versions, or internal error messages.
 */

import { Router, type Request, type Response } from 'express';
import { checkPgHealth } from '../../infrastructure/database/postgres/pool.js';
import { checkRedisHealth } from '../../infrastructure/redis/redis-client.js';

export const healthRouter = Router();

// Liveness flag indicating if process is undergoing graceful shutdown
let isDraining = false;

export function setDrainingStatus(draining: boolean): void {
  isDraining = draining;
}

export function getDrainingStatus(): boolean {
  return isDraining;
}

/**
 * GET /health/live
 * Process liveness probe. Always returns 200 if Node.js event loop is responding.
 */
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * GET /health/ready
 * Readiness probe. Checks connectivity to PostgreSQL and Redis with 1s timeout.
 * Returns 200 {"status": "ok"} when healthy.
 * Returns 503 {"status": "degraded"} if any dependency fails or during process drain.
 */
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  if (isDraining) {
    res.status(503).json({ status: 'degraded' });
    return;
  }

  const [pgHealthy, redisHealthy] = await Promise.all([
    checkPgHealth(1000),
    checkRedisHealth(undefined, 1000)
  ]);

  if (pgHealthy && redisHealthy) {
    res.status(200).json({ status: 'ok' });
  } else {
    res.status(503).json({ status: 'degraded' });
  }
});
