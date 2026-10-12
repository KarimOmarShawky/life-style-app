/**
 * tests/integration/worker-jobs.test.ts
 *
 * Validates Section 11: the PostgreSQL-backed job stores against the real
 * database — reminder claiming (SKIP LOCKED), sent transitions, orphan
 * cancellation, timer auto-close, and the retention purge.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getKyselyDb } from '../../src/infrastructure/database/postgres/kysely.js';
import { getPgPool, closePgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { closeRedisClient, getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import {
  PgReminderDispatchStore,
  PgTimerMaintenanceStore,
  PgPurgeStore,
  PgRecurringGenerationStore
} from '../../src/jobs/job-stores.pg.js';

const db = getKyselyDb();
const pool = getPgPool();
const redis = getRedisClient();

const reminderStore = new PgReminderDispatchStore(db);
const timerStore = new PgTimerMaintenanceStore(db);
const purgeStore = new PgPurgeStore(db);
const recurringStore = new PgRecurringGenerationStore(db);

let userId: string;

beforeEach(async () => {
  await pool.query('DELETE FROM users');
  await redis.flushdb();
  userId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, display_name, timezone, default_currency, created_at, updated_at)
     VALUES ($1, $2, 'x', 'Worker Test', 'UTC', 'USD', now(), now())`,
    [userId, `worker-${userId.slice(0, 8)}@example.com`]
  );
});

afterAll(async () => {
  await closeRedisClient(redis);
  await closePgPool();
});

async function createTask(taskId: string, deletedAt: Date | null = null): Promise<void> {
  await pool.query(
    `INSERT INTO tasks (id, user_id, title, due_date, priority, deleted_at, created_at, updated_at)
     VALUES ($1, $2, 'T', DATE '2026-11-30', 0, $3, now(), now())`,
    [taskId, userId, deletedAt]
  );
}

async function createReminder(
  id: string,
  taskId: string,
  channel: string,
  status: string,
  attemptCount: number
): Promise<void> {
  await pool.query(
    `INSERT INTO reminders (id, user_id, task_id, source, remind_at, offset_minutes,
       channel, status, next_attempt_at, attempt_count, created_at, updated_at)
     VALUES ($1, $2, $3, 'user', TIMESTAMPTZ '2026-11-30 08:00:00+00', 60,
       $4, $5, TIMESTAMPTZ '2026-11-30 08:00:00+00', $6, now(), now())`,
    [id, userId, taskId, channel, status, attemptCount]
  );
}

describe('PgReminderDispatchStore', () => {
  it('claims due pending reminders exactly once and marks them sent', async () => {
    const taskId = crypto.randomUUID();
    await createTask(taskId);
    await createReminder(crypto.randomUUID(), taskId, 'in_app', 'pending', 0);

    const now = new Date('2026-11-30T08:00:01Z');
    const first = await reminderStore.claimDue(now, 10);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ channel: 'in_app', attemptCount: 1 });

    // Already claimed (processing) — a second tick must not re-claim it.
    const second = await reminderStore.claimDue(now, 10);
    expect(second).toHaveLength(0);

    await reminderStore.markSent(first[0]!.id, now);
    const { rows } = await pool.query<{ status: string; sent_at: Date | null }>(
      'SELECT status, sent_at FROM reminders WHERE id = $1',
      [first[0]!.id]
    );
    expect(rows[0]?.status).toBe('sent');
    expect(rows[0]?.sent_at).not.toBeNull();
  });

  it('retry and failed transitions follow the dispatcher state machine', async () => {
    const taskId = crypto.randomUUID();
    await createTask(taskId);
    const id = crypto.randomUUID();
    await createReminder(id, taskId, 'push', 'pending', 1);

    const next = new Date('2026-11-30T08:05:00Z');
    await reminderStore.markRetry(id, next, 'DELIVERY_FAILED', 'PUSH_UNAVAILABLE');
    const retryRow = await pool.query<{
      status: string;
      next_attempt_at: Date | null;
      last_error_code: string | null;
    }>('SELECT status, next_attempt_at, last_error_code FROM reminders WHERE id = $1', [id]);
    expect(retryRow.rows[0]?.status).toBe('pending');
    expect(retryRow.rows[0]?.last_error_code).toBe('DELIVERY_FAILED');

    await reminderStore.markFailed(id, next, 'DELIVERY_FAILED', 'PUSH_UNAVAILABLE');
    const failedRow = await pool.query<{ status: string; next_attempt_at: Date | null }>(
      'SELECT status, next_attempt_at FROM reminders WHERE id = $1',
      [id]
    );
    expect(failedRow.rows[0]?.status).toBe('failed');
    expect(failedRow.rows[0]?.next_attempt_at).toBeNull();
  });

  it('cancels reminders whose parent is soft-deleted', async () => {
    const taskId = crypto.randomUUID();
    await createTask(taskId, new Date());
    await createReminder(crypto.randomUUID(), taskId, 'in_app', 'pending', 0);

    const cancelled = await reminderStore.cancelOrphans();
    expect(cancelled).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query<{ status: string; next_attempt_at: Date | null }>(
      'SELECT status, next_attempt_at FROM reminders WHERE user_id = $1',
      [userId]
    );
    expect(rows[0]?.status).toBe('cancelled');
    expect(rows[0]?.next_attempt_at).toBeNull();
  });
});

describe('PgTimerMaintenanceStore', () => {
  it('auto-closes sessions running past the cutoff with end_reason=auto_closed', async () => {
    const taskId = crypto.randomUUID();
    await createTask(taskId);
    await pool.query(
      `INSERT INTO timer_sessions (id, user_id, task_id, started_at, mode, created_at, updated_at)
       VALUES ($1, $2, $3, now() - interval '13 hours', 'stopwatch', now(), now())`,
      [crypto.randomUUID(), userId, taskId]
    );

    const closed = await timerStore.autoCloseStale(new Date(Date.now() - 12 * 3_600_000));
    expect(closed).toBe(1);
    const { rows } = await pool.query<{ end_reason: string | null; ended_at: Date | null }>(
      'SELECT end_reason, ended_at FROM timer_sessions WHERE user_id = $1',
      [userId]
    );
    expect(rows[0]?.end_reason).toBe('auto_closed');
    expect(rows[0]?.ended_at).not.toBeNull();
  });
});

describe('PgPurgeStore', () => {
  it('hard-deletes rows whose restore window expired and keeps fresh ones', async () => {
    const oldTaskId = crypto.randomUUID();
    const freshTaskId = crypto.randomUUID();
    await createTask(oldTaskId, new Date(Date.now() - 40 * 86_400_000));
    await createTask(freshTaskId, new Date(Date.now() - 2 * 86_400_000));

    const purged = await purgeStore.purgeSoftDeleted(new Date(Date.now() - 30 * 86_400_000));
    expect(purged).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query<{ id: string }>('SELECT id FROM tasks WHERE user_id = $1', [
      userId
    ]);
    expect(rows.map((r) => r.id)).toEqual([freshTaskId]);
  });
});

describe('PgRecurringGenerationStore', () => {
  it('is safe to run with no due recurrences', async () => {
    const generated = await recurringStore.generateDueOccurrences('2026-10-18');
    expect(generated).toBe(0);
  });
});
