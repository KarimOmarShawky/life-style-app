/**
 * Health, liveness and readiness endpoints (spec section 47).
 *
 * The three answer different questions and must not be collapsed into one:
 *
 *   /health    Is the process up? Cheap, no dependencies touched.
 *   /liveness  Should the orchestrator RESTART this container? Only process-level
 *              faults count. A failing database must NOT fail liveness, or every
 *              instance restart-loops during a database incident and the outage
 *              gets worse.
 *   /readiness Should traffic be ROUTED here? Dependencies are checked, so an
 *              instance that cannot reach PostgreSQL is pulled from the pool
 *              while staying alive to recover.
 *
 * None of them reveal versions, hostnames, connection strings or error detail:
 * these are the most-probed endpoints on any deployment (spec section 47).
 */
import { Router, type Request, type Response } from 'express';

import { asyncHandler } from '@/core/middleware/async-handler';
import { isMongoConnected, pingMongo } from '@/infrastructure/database/mongodb/connection';
import { pingPostgres } from '@/infrastructure/database/postgres/pool';
import { pingRedis } from '@/infrastructure/database/redis/client';
import { config, hasMongo, hasRedis } from '@/config';

type DependencyState = 'up' | 'down' | 'not_configured';

interface ReadinessReport {
  status: 'ready' | 'degraded' | 'unavailable';
  dependencies: {
    postgres: DependencyState;
    mongodb: DependencyState;
    redis: DependencyState;
  };
}

async function buildReadiness(): Promise<ReadinessReport> {
  const [postgresUp, mongoUp, redisUp] = await Promise.all([
    pingPostgres(),
    hasMongo ? pingMongo() : Promise.resolve(false),
    hasRedis ? pingRedis() : Promise.resolve(false),
  ]);

  const dependencies = {
    postgres: postgresUp ? ('up' as const) : ('down' as const),
    mongodb: !hasMongo
      ? ('not_configured' as const)
      : mongoUp
        ? ('up' as const)
        : ('down' as const),
    redis: !hasRedis ? ('not_configured' as const) : redisUp ? ('up' as const) : ('down' as const),
  };

  // PostgreSQL is the only hard requirement: without it every authenticated
  // request fails. MongoDB and Redis being down degrades features rather than
  // removing the service, so they do not make the instance unroutable.
  if (!postgresUp) {
    return { status: 'unavailable', dependencies };
  }

  const degraded =
    (hasMongo && !mongoUp) ||
    (hasRedis && !redisUp) ||
    (config.NODE_ENV === 'production' && !hasMongo);

  return { status: degraded ? 'degraded' : 'ready', dependencies };
}

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  router.get('/liveness', (_req: Request, res: Response) => {
    // Reaching this handler proves the event loop is running, which is the whole
    // question. Deliberately touches nothing else.
    res.status(200).json({ status: 'alive', uptimeSeconds: Math.floor(process.uptime()) });
  });

  router.get(
    '/readiness',
    asyncHandler(async (_req: Request, res: Response) => {
      const report = await buildReadiness();
      // 'degraded' still returns 200: the instance can serve traffic, just not
      // every feature. Only 'unavailable' takes it out of rotation.
      res.status(report.status === 'unavailable' ? 503 : 200).json(report);
    }),
  );

  // Mongo readiness is reported above; this keeps the import used and documents
  // that connection state is observable without a round trip.
  router.get('/readiness/mongo', (_req: Request, res: Response) => {
    res.status(200).json({ connected: isMongoConnected() });
  });

  return router;
}
