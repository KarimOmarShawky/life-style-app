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
import { Pool as PgPool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { validateEnv, getEnv } from './config/env.js';
import { logger } from './core/logger/logger.js';
import { SystemClock } from './core/time/clock.js';
import { closePgPool, getPgPool } from './infrastructure/database/postgres/pool.js';
import { getKyselyDb, type DatabaseSchema } from './infrastructure/database/postgres/kysely.js';
import { closeRedisClient, getRedisClient } from './infrastructure/redis/redis-client.js';
import { SmtpEmailSender } from './infrastructure/external/email-sender.js';
import { ResetRequestDispatcher } from './core/security/reset-request-dispatcher.js';
import { PgPasswordResetRequestStore } from './features/auth/password-reset-request.repository.pg.js';
import { PasswordResetProcessor } from './features/auth/password-reset.processor.js';
import { PgAuthRepository } from './features/auth/auth.repository.pg.js';
import { RedisOtpStore } from './core/security/otp-service.js';
import { PgAuditLogger } from './infrastructure/database/postgres/audit-logger.js';
import {
  processReminderDispatch,
  processRecurringGeneration,
  processTimerAutoClose,
  processPurge,
  processSessionRetention,
  processAuditRetention
} from './jobs/job-processors.js';
import {
  PgReminderDispatchStore,
  PgUserEmailLookup,
  PgRecurringGenerationStore,
  PgTimerMaintenanceStore,
  PgPurgeStore,
  PgSessionRetentionStore,
  PgAuditRetentionStore
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
const sessionRetentionStore = new PgSessionRetentionStore(db);

// Audit-log retention runs under the maintenance role: DELETE on audit_logs
// is granted to lifestyle_maintenance only (least privilege). When the
// maintenance URL is not configured, the schedule is not registered and the
// gap is logged instead of failing every tick.
let auditRetentionStore: PgAuditRetentionStore | null = null;
let maintenancePool: PgPool | null = null;
if (env.DATABASE_MAINTENANCE_URL) {
  maintenancePool = new PgPool({
    connectionString: env.DATABASE_MAINTENANCE_URL,
    max: 2,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : false,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS
  });
  maintenancePool.on('error', (err) => {
    logger.error('Unexpected error on idle maintenance PostgreSQL pool', err);
  });
  auditRetentionStore = new PgAuditRetentionStore(
    new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool: maintenancePool }) })
  );
} else {
  logger.warn(
    'DATABASE_MAINTENANCE_URL is not set; audit-log retention schedule will not be registered'
  );
}

// BullMQ needs a connection without request retries; keep it separate from the
// shared application client used for OTP/rate-limit state.
const bullConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Durable password-reset delivery (F-06). The API process persists every
// accepted request and drains it immediately; this worker drains what a crash,
// restart, forced shutdown or SMTP failure left behind, releases expired
// leases, and applies the retention window. Rows are claimed with SKIP LOCKED,
// so both processes can run against the same table safely.
const resetRequestStore = new PgPasswordResetRequestStore(db);
const resetProcessor = new PasswordResetProcessor(
  new PgAuthRepository(getPgPool()),
  new RedisOtpStore(getRedisClient()),
  emailSender,
  new PgAuditLogger(getPgPool())
);
const resetDispatcher = new ResetRequestDispatcher(
  ({ email, meta }) => resetProcessor.process(email, meta),
  { store: resetRequestStore, concurrency: 2, maxAttempts: 5, retryBackoffMs: 30_000 }
);
// Completed and dead-lettered rows hold an email address; do not keep them.
const RESET_RETENTION_MS = 24 * 60 * 60 * 1000;
const RESET_RETENTION_BATCH = 500;

const MAINTENANCE_QUEUE = 'maintenance';

// Unavailable push delivery: FCM credentials are optional (Phase P1) and no
// provider is wired up here, so push is permanently unavailable in this
// deployment. Push-channel reminders therefore fail immediately instead of
// retrying five times (F-04). Ship a real PushSender (and drop
// `permanentlyUnavailable`) when a provider is configured.
const pushSender = {
  isAvailable: () => false,
  permanentlyUnavailable: true,
  send: async (): Promise<void> => {
    throw new Error('PUSH_UNAVAILABLE');
  }
};

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
      case 'purge-expired-sessions': {
        const result = await processSessionRetention(clock, sessionRetentionStore);
        logger.info('Expired-session purge tick', result);
        break;
      }
      case 'reset-request-recovery': {
        const recovered = await resetDispatcher.recoverStale();
        const claimed = await resetDispatcher.drainDue();
        const purged = await resetRequestStore.purgeOlderThan(
          new Date(clock.now().getTime() - RESET_RETENTION_MS),
          RESET_RETENTION_BATCH
        );
        logger.info('Password reset recovery tick', { recovered, claimed, purged });
        break;
      }
      case 'audit-retention': {
        if (!auditRetentionStore) {
          logger.warn('Audit retention job ran without a maintenance-role store');
          break;
        }
        const result = await processAuditRetention(clock, auditRetentionStore);
        logger.info('Audit retention tick', result);
        break;
      }
      default:
        logger.warn(`Unknown maintenance job: ${job.name}`);
    }
  },
  { connection: bullConnection }
);

const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection: bullConnection });

// Never log job data or provider errors: these may contain recipients or message bodies.
maintenanceWorker.on('failed', (job) => {
  logger.error('Maintenance job failed', { jobId: job?.id, jobName: job?.name });
});
maintenanceWorker.on('error', () => logger.error('Maintenance worker connection error'));

async function registerSchedules(): Promise<void> {
  await maintenanceQueue.upsertJobScheduler(
    'reminder-dispatch',
    { pattern: '* * * * *' },
    { name: 'reminder-dispatch', data: {} }
  );
  await maintenanceQueue.upsertJobScheduler(
    'reset-request-recovery',
    { pattern: '*/2 * * * *' },
    { name: 'reset-request-recovery', data: {} }
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
  await maintenanceQueue.upsertJobScheduler(
    'purge-expired-sessions',
    { pattern: '45 3 * * *' },
    { name: 'purge-expired-sessions', data: {} }
  );
  if (auditRetentionStore) {
    await maintenanceQueue.upsertJobScheduler(
      'audit-retention',
      { pattern: '0 4 1 * *' },
      { name: 'audit-retention', data: {} }
    );
  }
  logger.info('Maintenance schedules registered');
}

let isShuttingDown = false;

async function handleWorkerShutdown(signal: string, exitCode = 0): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`Worker received ${signal}. Gracefully stopping job processing...`);

  try {
    // BullMQ workers stop taking jobs and drain active ones here (spec 4.7).
    await maintenanceWorker.close();
    await maintenanceQueue.close();
    await bullConnection.quit();

    await closeRedisClient(getRedisClient());
    await closePgPool();
    if (maintenancePool) {
      await maintenancePool.end();
    }

    logger.info('Worker shutdown complete. Exiting cleanly.');
    process.exit(exitCode);
  } catch (err) {
    logger.error('Worker shutdown encountered error', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void handleWorkerShutdown('SIGTERM'));
process.on('SIGINT', () => void handleWorkerShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.fatal('Worker uncaught exception', err);
  void handleWorkerShutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal('Worker unhandled rejection', reason);
  void handleWorkerShutdown('unhandledRejection', 1);
});

registerSchedules().catch(() => {
  logger.error('Failed to register maintenance schedules');
  void handleWorkerShutdown('schedule-registration-failed', 1);
});
