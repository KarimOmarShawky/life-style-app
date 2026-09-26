/**
 * src/worker.ts
 *
 * Implements Section 4.1, 4.7 & 11: Background Worker Process Entry Point.
 * Handles BullMQ queue processing, maintenance schedules, and graceful shutdown.
 */

import { validateEnv, getEnv } from './config/env.js';
import { logger } from './core/logger/logger.js';
import { closePgPool } from './infrastructure/database/postgres/pool.js';
import { closeRedisClient, getRedisClient } from './infrastructure/redis/redis-client.js';

validateEnv();
const env = getEnv();

logger.info(`Starting LifeStyle Worker process [NODE_ENV=${env.NODE_ENV}]...`);

// Ensure Redis connection for BullMQ
const redis = getRedisClient();

let isShuttingDown = false;

async function handleWorkerShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`Worker received ${signal}. Gracefully stopping job processing...`);

  try {
    // BullMQ workers stop taking jobs and drain active ones here (expanded in P8/P9)
    await closeRedisClient(redis);
    await closePgPool();

    logger.info('Worker shutdown complete. Exiting cleanly.');
    process.exit(0);
  } catch (err) {
    logger.error('Worker shutdown encountered error', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void handleWorkerShutdown('SIGTERM'));
process.on('SIGINT', () => void handleWorkerShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.fatal('Worker uncaught exception', err);
  void handleWorkerShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal('Worker unhandled rejection', reason);
  void handleWorkerShutdown('unhandledRejection');
});

logger.info('LifeStyle Worker process initialized and waiting for jobs.');
