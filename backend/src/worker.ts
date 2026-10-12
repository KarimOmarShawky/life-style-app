/**
 * src/worker.ts
 *
 * Implements Section 4.1, 4.7 & 11: Background Worker Process Entry Point.
 * Runs the BullMQ queues: queued emails, due-reminder dispatch (every minute),
 * recurring-task generation and timer auto-close (hourly), and the soft-delete
 * retention purge (nightly). Graceful shutdown drains workers before closing
 * Redis and PostgreSQL.
 */

import { Redis as IORedis } from 'ioredis';
import { Worker, Queue } from 'bullmq';
import { validateEnv, getEnv } from './config/env.js';
import { logger } from './core/logger/logger.js';
import { SystemClock } from './core/time/clock.js';
import { closePgPool } from './infrastructure/database/postgres/pool.js';
import { getKyselyDb } from './infrastructure/database/postgres/kysely.js';
import { closeRedisClient, getRedisClient } from './infrastructure/redis/redis-client.js';
import { SmtpEmailSender } from './infrastructure/external/email-sender.js';
import { EMAIL_QUEUE_NAME, type PasswordResetEmailJob } from './jobs/email-queue.js';
import {
  processReminderDispatch,
  processRecurringGeneration,
  processTimerAutoClose,
  processPurge,
  processPasswordResetEmail
} from './jobs/job-processors.js';
import {
  PgReminderDispatchStore,
  PgUserEmailLookup,
  PgRecurringGenerationStore,
  PgTimerMaintenanceStore,
  PgPurgeStore
} from './jobs/job-stores.pg.js';

validateEnv();
const env = getEnv();

logger.info(`Starting LifeStyle Worker process [NODE_ENV=${env.NODE_ENV}]...`);

const clock = new SystemClock();
const db = getKyselyDb();
const emailSender = new SmtpEmailSender();
const reminderStore = new PgReminderDispatchStore(db);
const userEmails = new PgUserEmailLookup(db);
const recurringStore = new PgRecurringGenerationStore(db);
const timerStore = new PgTimerMaintenanceStore(db);
const purgeStore = new PgPurgeStore(db);

// BullMQ needs a connection without request retries; keep it separate from the
// shared application client used for OTP/rate-limit state.
const bullConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const MAINTENANCE_QUEUE = 'maintenance';

// Unavailable push delivery: FCM credentials are optional (Phase P1). Without
// them, push-channel reminders retry and then fail with PUSH_UNAVAILABLE.
const pushSender = {
  isAvailable: () => Boolean(getEnv().FCM_CREDENTIALS),
  send: async (): Promise<void> => {
    throw new Error('PUSH_UNAVAILABLE');
  }
};

const emailWorker = new Worker<PasswordResetEmailJob>(
  EMAIL_QUEUE_NAME,
  async (job) => {
    if (job.name === 'password-reset') {
      await processPasswordResetEmail(job.data, emailSender);
    }
  },
  { connection: bullConnection }
);

const maintenanceWorker = new Worker(
  MAINTENANCE_QUEUE,
  async (job) => {
    switch (job.name) {
      case 'reminder-dispatch': {
        const result = await processReminderDispatch(
          clock,
          reminderStore,
          userEmails,
          emailSender,
          pushSender
        );
        logger.info('Reminder dispatch tick', result);
        break;
      }
      case 'recurring-generation': {
        // Keep occurrences one week ahead (matches the create-time window).
        const horizon = new Date(clock.now().getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
        const result = await processRecurringGeneration(recurringStore, horizon);
        logger.info('Recurring generation tick', result);
        break;
      }
      case 'timer-auto-close': {
        const result = await processTimerAutoClose(clock, timerStore);
        logger.info('Timer auto-close tick', result);
        break;
      }
      case 'purge-soft-deleted': {
        const result = await processPurge(clock, purgeStore);
        logger.info('Soft-delete purge tick', result);
        break;
      }
      default:
        logger.warn(`Unknown maintenance job: ${job.name}`);
    }
  },
  { connection: bullConnection }
);

const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection: bullConnection });

async function registerSchedules(): Promise<void> {
  await maintenanceQueue.upsertJobScheduler(
    'reminder-dispatch',
    { pattern: '* * * * *' },
    { name: 'reminder-dispatch', data: {} }
  );
  await maintenanceQueue.upsertJobScheduler(
    'recurring-generation',
    { pattern: '5 * * * *' },
    { name: 'recurring-generation', data: {} }
  );
  await maintenanceQueue.upsertJobScheduler(
    'timer-auto-close',
    { pattern: '15 * * * *' },
    { name: 'timer-auto-close', data: {} }
  );
  await maintenanceQueue.upsertJobScheduler(
    'purge-soft-deleted',
    { pattern: '30 3 * * *' },
    { name: 'purge-soft-deleted', data: {} }
  );
  logger.info('Maintenance schedules registered');
}

let isShuttingDown = false;

async function handleWorkerShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`Worker received ${signal}. Gracefully stopping job processing...`);

  try {
    // BullMQ workers stop taking jobs and drain active ones here (spec 4.7).
    await emailWorker.close();
    await maintenanceWorker.close();
    await maintenanceQueue.close();
    await bullConnection.quit();

    await closeRedisClient(getRedisClient());
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

registerSchedules().catch((err) => {
  logger.error('Failed to register maintenance schedules', err);
});
