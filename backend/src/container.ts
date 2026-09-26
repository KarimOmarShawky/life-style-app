/**
 * src/container.ts
 *
 * Implements Section 4.4 & ADR-021: Composition root and manual dependency injection.
 * Wires concrete implementations to interfaces without runtime DI frameworks.
 */

import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { getPgPool } from './infrastructure/database/postgres/pool.js';
import { getKyselyDb, type DatabaseSchema } from './infrastructure/database/postgres/kysely.js';
import {
  PgTransactionRunner,
  type TransactionRunner
} from './infrastructure/database/postgres/transaction-runner.js';
import { getRedisClient } from './infrastructure/redis/redis-client.js';
import {
  RedisRateLimiter,
  MemoryRateLimiter,
  type RateLimiter
} from './core/middleware/rate-limiter.js';
import { SystemClock, type Clock } from './core/time/clock.js';
import { UuidGenerator, type IdGenerator } from './core/security/id-generator.js';

export interface AppContainer {
  clock: Clock;
  idGenerator: IdGenerator;
  pgPool: pg.Pool;
  db: Kysely<DatabaseSchema>;
  transactionRunner: TransactionRunner<DatabaseSchema>;
  redis: Redis;
  rateLimiter: RateLimiter;
}

let containerInstance: AppContainer | null = null;

export function buildContainer(overrides?: Partial<AppContainer>): AppContainer {
  if (containerInstance && !overrides) {
    return containerInstance;
  }

  const clock = overrides?.clock ?? new SystemClock();
  const idGenerator = overrides?.idGenerator ?? new UuidGenerator();
  const pgPool = overrides?.pgPool ?? getPgPool();
  const db = overrides?.db ?? getKyselyDb();
  const transactionRunner = overrides?.transactionRunner ?? new PgTransactionRunner(db);
  const redis = overrides?.redis ?? getRedisClient();

  const rateLimiter =
    overrides?.rateLimiter ??
    (process.env.NODE_ENV === 'test' ? new MemoryRateLimiter() : new RedisRateLimiter(redis));

  const container: AppContainer = {
    clock,
    idGenerator,
    pgPool,
    db,
    transactionRunner,
    redis,
    rateLimiter
  };

  if (!overrides) {
    containerInstance = container;
  }

  return container;
}

export function getContainer(): AppContainer {
  if (!containerInstance) {
    return buildContainer();
  }
  return containerInstance;
}
