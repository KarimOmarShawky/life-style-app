/**
 * src/server.ts
 *
 * Implements Section 4.7: API Server Process Entry Point & Graceful Shutdown.
 * Manages HTTP listener lifecycle, handles OS termination signals (SIGTERM/SIGINT),
 * drains in-flight connections with a 30s timeout, closes Redis and PostgreSQL pools,
 * and exits cleanly with code 0.
 */

import http from 'node:http';
import { createApp } from './app.js';
import { getEnv, validateEnv } from './config/env.js';
import { logger } from './core/logger/logger.js';
import { setDrainingStatus } from './features/health/health.routes.js';
import { closePgPool } from './infrastructure/database/postgres/pool.js';
import { closeRedisClient } from './infrastructure/redis/redis-client.js';

// Validate environment variables fail-fast
validateEnv();
const env = getEnv();

const app = createApp();
const server = http.createServer(app);

// Keep-alive timeouts tuned per Section 16.2
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

let isShuttingDown = false;

async function handleShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // 1. Immediately flip readiness health probe to failing (503 degraded) so LB drains traffic
  setDrainingStatus(true);

  // 2. Stop accepting new HTTP connections
  server.close(async (err) => {
    if (err) {
      logger.error('Error while closing HTTP server', err);
      process.exit(1);
    }

    logger.info('HTTP server closed. Draining database and cache connections...');

    try {
      // 3. Close Redis connection
      await closeRedisClient();

      // 4. Close PostgreSQL connection pool
      await closePgPool();

      logger.info('Graceful shutdown completed successfully. Exiting.');
      process.exit(0);
    } catch (shutdownErr) {
      logger.error('Error during infrastructure disconnection', shutdownErr);
      process.exit(1);
    }
  });

  // 5. Force termination if in-flight requests exceed 30 seconds cap (Section 4.7)
  const shutdownTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out after 30s. Forcing exit.');
    process.exit(1);
  }, 30000);

  shutdownTimer.unref();
}

process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
process.on('SIGINT', () => void handleShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.fatal('Uncaught exception detected', err);
  void handleShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal('Unhandled promise rejection detected', reason);
  void handleShutdown('unhandledRejection');
});

server.listen(env.PORT, '0.0.0.0', () => {
  logger.info(`LifeStyle API server listening on port ${env.PORT} [NODE_ENV=${env.NODE_ENV}]`);
});

// Dual listener ensures both Railway standard port (8080) and custom port (3000) respond
const secondaryPorts = [3000, 8080].filter((p) => p !== env.PORT);
for (const p of secondaryPorts) {
  try {
    const fallbackServer = http.createServer(app);
    fallbackServer.listen(p, '0.0.0.0', () => {
      logger.info(`LifeStyle API auxiliary listener active on port ${p}`);
    }).on('error', () => {
      // Ignore if port already in use
    });
  } catch {
    // Continue with primary server
  }
}
