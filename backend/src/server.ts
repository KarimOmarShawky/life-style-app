/**
 * Process entry point: startup ordering and graceful shutdown (spec section 48).
 *
 * STARTUP. Configuration is validated first, by importing `config`, so a missing
 * variable fails before a port is bound or a connection opened. PostgreSQL must
 * connect or the process exits; MongoDB and Redis are allowed to fail into
 * degraded mode, matching how readiness reports them.
 *
 * SHUTDOWN. On SIGTERM the order is: stop accepting connections, let in-flight
 * requests finish, then close Redis, MongoDB and PostgreSQL. Closing the
 * databases first would fail the very requests we are trying to let finish. A
 * timer bounds the wait, because a hung request must not block a deploy forever.
 */
import type { Server } from 'node:http';

import { config } from '@/config';
import { createLogger, logger } from '@/core/logger';
import { closeMongo, connectMongo } from '@/infrastructure/database/mongodb/connection';
import { closePostgres, connectPostgres } from '@/infrastructure/database/postgres/pool';
import { closeRedis, connectRedis } from '@/infrastructure/database/redis/client';

import { createApp } from './app';

const log = createLogger('server');

let server: Server | undefined;
let shuttingDown = false;

async function closeDependencies(): Promise<void> {
  // Reverse of startup order, and tolerant: one failing close must not prevent
  // the others from running.
  const results = await Promise.allSettled([closeRedis(), closeMongo(), closePostgres()]);

  for (const result of results) {
    if (result.status === 'rejected') {
      log.error({ err: result.reason }, 'Error while closing a dependency');
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    log.warn({ signal }, 'Shutdown already in progress');
    return;
  }
  shuttingDown = true;

  log.info({ signal }, 'Shutdown initiated');

  // Hard deadline. If in-flight requests have not drained by now, exiting is
  // better than hanging: the orchestrator would SIGKILL us shortly anyway, and
  // that path skips dependency cleanup entirely.
  const forceExit = setTimeout(() => {
    log.error(
      { timeoutMs: config.SHUTDOWN_TIMEOUT_MS },
      'Graceful shutdown timed out; forcing exit',
    );
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    if (server) {
      await new Promise<void>((resolve) => {
        // Stops accepting new connections; the callback fires once existing ones
        // have finished.
        server?.close(() => {
          resolve();
        });
      });
      log.info('HTTP server stopped accepting connections');
    }

    await closeDependencies();
    clearTimeout(forceExit);
    log.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    log.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
}

async function start(): Promise<void> {
  log.info({ env: config.NODE_ENV, port: config.PORT }, 'Starting LifeStyle API');

  // Hard dependency: without PostgreSQL nothing authenticated can work, so
  // failing here is better than serving errors from a running process.
  await connectPostgres();

  // Soft dependencies: connect if configured, degrade if not.
  await connectMongo();
  await connectRedis();

  const app = createApp();

  server = app.listen(config.PORT, () => {
    log.info({ port: config.PORT, apiPrefix: config.API_PREFIX }, 'HTTP server listening');
  });

  // Node's default is no timeout, which lets a slow client hold a socket open
  // indefinitely. These bound that.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 15_000;
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

/**
 * An unhandled rejection or uncaught exception leaves the process in an unknown
 * state. Logging and continuing risks serving corrupted results, so the only
 * safe response is to log with full detail and shut down for the supervisor to
 * replace us.
 */
process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (error: Error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException');
});

start().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start the server');
  process.exit(1);
});
