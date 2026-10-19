import { PgUsersRepository } from '../features/users/users.repository.pg.js';
import { getPgPool } from '../infrastructure/database/postgres/pool.js';
/**
 * src/jobs/job-stores.pg.ts
 *
 * PostgreSQL stores for the background job processors. This module is
 * infrastructure-level maintenance orchestration (Section 11): it is allowed to
 * touch several features' tables for dispatch bookkeeping and retention purges,
 * while all user-facing mutations stay inside the feature services.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../infrastructure/database/postgres/kysely.js';
import type {
  ReminderDispatchStore,
  DispatchableReminder,
  UserEmailLookup,
  RecurringGenerationStore,
  TimerMaintenanceStore,
  PurgeStore,
  SessionRetentionStore,
  AuditRetentionStore
} from './job-processors.js';
import { computeOccurrences } from '../features/recurring-tasks/recurrence-engine.js';
import type {
  RecurrenceRow,
  RecurringTaskRow
} from '../features/recurring-tasks/recurring-tasks.types.js';
import { formatDateOnly } from '../core/time/date-utils.js';

export class PgReminderDispatchStore implements ReminderDispatchStore {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async claimDue(now: Date, limit: number): Promise<DispatchableReminder[]> {
    // A dead worker cannot strand a reminder forever. Five crashed attempts are terminal.
    await sql`
      UPDATE reminders SET status = 'failed', failed_at = ${now}, next_attempt_at = NULL,
        last_error_code = 'LEASE_EXPIRED', last_error_message = 'Delivery outcome unknown after worker interruption',
        updated_at = ${now}
      WHERE status = 'processing' AND attempt_count >= 5
        AND processing_started_at < ${now}::timestamptz - interval '10 minutes'
    `.execute(this.db);
    // Atomic lease: skip locked claims. External delivery remains at-least-once after a crash.
    const rows = await sql<{
      id: string;
      user_id: string;
      entity_type: 'task' | 'habit' | 'event' | 'subscription';
      entity_id: string;
      channel: 'push' | 'in_app' | 'email';
      remind_at: Date;
      attempt_count: number;
    }>`
      UPDATE reminders r
      SET status = 'processing',
          processing_started_at = ${now},
          attempt_count = r.attempt_count + 1,
          updated_at = ${now}
      WHERE r.id IN (
        SELECT id FROM reminders
        WHERE attempt_count < 5 AND (
          (status = 'pending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ${now}) OR
          (status = 'processing' AND processing_started_at < ${now}::timestamptz - interval '10 minutes')
        )
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING r.id, r.user_id, r.entity_type, r.entity_id, r.channel, r.remind_at, r.attempt_count
    `.execute(this.db);

    return rows.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      channel: row.channel,
      remindAt: row.remind_at,
      attemptCount: row.attempt_count
    }));
  }

  public async markSent(id: string, sentAt: Date, attemptCount: number): Promise<void> {
    await this.db
      .updateTable('reminders')
      .set({ status: 'sent', sent_at: sentAt, next_attempt_at: null, updated_at: sentAt })
      .where('id', '=', id)
      .where('status', '=', 'processing')
      .where('attempt_count', '=', attemptCount)
      .execute();
  }

  public async markRetry(
    id: string,
    nextAttemptAt: Date,
    errorCode: string,
    errorMessage: string,
    attemptCount: number
  ): Promise<void> {
    await this.db
      .updateTable('reminders')
      .set({
        status: 'pending',
        next_attempt_at: nextAttemptAt,
        last_error_code: errorCode,
        last_error_message: errorMessage
      })
      .where('id', '=', id)
      .where('status', '=', 'processing')
      .where('attempt_count', '=', attemptCount)
      .execute();
  }

  public async markFailed(
    id: string,
    failedAt: Date,
    errorCode: string,
    errorMessage: string,
    attemptCount: number
  ): Promise<void> {
    await this.db
      .updateTable('reminders')
      .set({
        status: 'failed',
        failed_at: failedAt,
        next_attempt_at: null,
        last_error_code: errorCode,
        last_error_message: errorMessage
      })
      .where('id', '=', id)
      .where('status', '=', 'processing')
      .where('attempt_count', '=', attemptCount)
      .execute();
  }

  public async cancelOrphans(): Promise<number> {
    // Reminders whose parent was soft-deleted (or gone) must never fire. The
    // feature services cancel on delete; this is the safety net for restores,
    // direct data changes, and parents deleted before the hooks existed.
    const result = await sql<{ id: string }>`
      UPDATE reminders
      SET status = 'cancelled', next_attempt_at = NULL, updated_at = now()
      WHERE status IN ('pending', 'processing')
        AND (
          (task_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM tasks t WHERE t.id = reminders.task_id AND t.user_id = reminders.user_id AND t.deleted_at IS NULL
          ))
          OR (habit_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM habits h WHERE h.id = reminders.habit_id AND h.user_id = reminders.user_id AND h.deleted_at IS NULL
          ))
          OR (event_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM events e WHERE e.id = reminders.event_id AND e.user_id = reminders.user_id AND e.deleted_at IS NULL
          ))
          OR (subscription_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM subscriptions s WHERE s.id = reminders.subscription_id AND s.user_id = reminders.user_id AND s.deleted_at IS NULL
          ))
        )
      RETURNING id
    `.execute(this.db);
    return result.rows.length;
  }
}

export class PgUserEmailLookup implements UserEmailLookup {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async findEmails(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('id', 'in', userIds)
      .execute();
    return new Map(rows.map((row) => [row.id, row.email]));
  }
}

export class PgRecurringGenerationStore implements RecurringGenerationStore {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async generateDueOccurrences(horizonDate: string): Promise<number> {
    const due = await this.db
      .selectFrom('recurring_tasks as rt')
      .innerJoin('recurrences as rec', 'rec.recurring_task_id', 'rt.id')
      .select([
        'rt.id as id',
        'rt.user_id as user_id',
        'rt.title as title',
        'rt.description as description',
        'rt.priority as priority',
        'rt.estimate_minutes as estimate_minutes',
        'rt.due_time as due_time',
        'rt.project_id as project_id',
        'rt.generated_through as generated_through',
        'rec.freq as freq',
        'rec.interval as interval',
        'rec.by_weekday as by_weekday',
        'rec.by_month_day as by_month_day',
        'rec.by_month as by_month',
        'rec.start_date as start_date',
        'rec.end_date as end_date',
        'rec.occurrence_limit as occurrence_limit'
      ])
      .where('rt.status', '=', 'active')
      .where('rt.deleted_at', 'is', null)
      .where('rt.generated_through', 'is not', null)
      .where('rt.generated_through', '<', horizonDate)
      .execute();

    let generated = 0;
    for (const row of due) {
      const rule = {
        freq: row.freq,
        interval: row.interval,
        byWeekday: row.by_weekday,
        byMonthDay: row.by_month_day,
        byMonth: row.by_month,
        startDate: formatDateOnly(row.start_date)!,
        endDate: formatDateOnly(row.end_date),
        occurrenceLimit: row.occurrence_limit
      };
      const from = formatDateOnly(row.generated_through) ?? rule.startDate;
      // Window is (generated_through, horizon]: computeOccurrences is inclusive,
      // so start one day after the generated-through date.
      const windowStart = addDays(from, 1);
      const occurrences = computeOccurrences(rule, windowStart, horizonDate).filter(
        (date) => date > from
      );
      if (occurrences.length > 0) {
        const values = occurrences.map((occDate) => ({
          user_id: row.user_id,
          title: row.title,
          description: row.description,
          status: 'todo' as const,
          priority: row.priority,
          due_date: occDate,
          due_time: row.due_time,
          planned_date: occDate,
          is_focus: false,
          estimate_minutes: row.estimate_minutes,
          project_id: row.project_id,
          recurring_task_id: row.id,
          occurrence_date: occDate,
          is_customized: false,
          completed_at: null
        }));
        await this.db
          .insertInto('tasks')
          .values(values)
          .onConflict((oc) =>
            oc
              .columns(['recurring_task_id', 'occurrence_date'])
              .where('recurring_task_id', 'is not', null)
              .doNothing()
          )
          .execute();
        generated += occurrences.length;
      }
      await this.db
        .updateTable('recurring_tasks')
        .set({ generated_through: horizonDate })
        .where('id', '=', row.id)
        .execute();
    }
    return generated;
  }
}

function addDays(dateStr: string, days: number): string {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export class PgTimerMaintenanceStore implements TimerMaintenanceStore {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async autoCloseStale(cutoff: Date): Promise<number> {
    const result = await sql<{ id: string }>`
      UPDATE timer_sessions
      SET ended_at = started_at + interval '12 hours', end_reason = 'auto_closed', updated_at = now()
      WHERE ended_at IS NULL AND started_at < ${cutoff}
      RETURNING id
    `.execute(this.db);
    return result.rows.length;
  }
}

export class PgPurgeStore implements PurgeStore {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async purgeSoftDeleted(cutoff: Date): Promise<number> {
    // Tables with a soft-delete restore window. FK cascades clean up children.
    const tables = [
      'tasks',
      'habits',
      'events',
      'notes',
      'projects',
      'goals',
      'recurring_tasks',
      'transactions',
      'budgets',
      'subscriptions'
    ];
    let purged = 0;
    for (const table of tables) {
      const result = await sql<{ id: string }>`
        DELETE FROM ${sql.table(table)} WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff} RETURNING id
      `.execute(this.db);
      purged += result.rows.length;
    }
    return purged;
  }

  public async purgeExpiredAccounts(now: Date): Promise<number> {
    return new PgUsersRepository(getPgPool()).purgeExpiredAccounts(now);
  }
}

/**
 * Session retention store: the runtime role holds DELETE on auth_sessions,
 * so expired sessions are purged through the ordinary pool.
 */
export class PgSessionRetentionStore implements SessionRetentionStore {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async purgeExpiredSessions(cutoff: Date): Promise<number> {
    const result = await sql<{ id: string }>`
      DELETE FROM auth_sessions WHERE absolute_expires_at < ${cutoff} RETURNING id
    `.execute(this.db);
    return result.rows.length;
  }
}

/**
 * Audit retention store: audit_logs DELETE is granted only to the
 * maintenance role (least privilege, B-07 residual: 12-month audit
 * retention), so this store must run on a maintenance-role connection.
 */
export class PgAuditRetentionStore implements AuditRetentionStore {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async purgeAuditLogsOlderThan(cutoff: Date): Promise<number> {
    const result = await sql<{ id: string }>`
      DELETE FROM audit_logs WHERE occurred_at < ${cutoff} RETURNING id
    `.execute(this.db);
    return result.rows.length;
  }
}

export type { RecurringTaskRow, RecurrenceRow };
