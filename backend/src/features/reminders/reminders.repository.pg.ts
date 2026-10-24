/**
 * src/features/reminders/reminders.repository.pg.ts
 *
 * Implements Section 4.3 & 6.8: PostgreSQL (Kysely) implementation of the
 * Unified Reminders repository. Parent ownership violations surface from the
 * composite FKs as SQLSTATE 23503 and are translated to a 404 so cross-user
 * parents can never be probed.
 */

import { type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type { RemindersRepository } from './reminders.repository.js';
import type {
  ReminderEntity,
  CreateReminderRepoInput,
  ListRemindersFilter,
  UpdateReminderRepoInput,
  ReminderParentKind
} from './reminders.types.js';
import { AppError } from '../../core/errors/app-error.js';
import { zonedDateTimeToUtc } from '../../core/time/date-utils.js';

interface ReminderDbRow {
  id: string;
  user_id: string;
  task_id: string | null;
  habit_id: string | null;
  event_id: string | null;
  subscription_id: string | null;
  entity_type: 'task' | 'habit' | 'event' | 'subscription';
  entity_id: string;
  source: 'user' | 'system';
  remind_at: Date;
  offset_minutes: number | null;
  channel: 'push' | 'in_app' | 'email';
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  next_attempt_at: Date | null;
  attempt_count: number;
  processing_started_at: Date | null;
  sent_at: Date | null;
  failed_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  dedupe_key: string | null;
  created_at: Date;
  updated_at: Date;
}

function toEntity(row: ReminderDbRow): ReminderEntity {
  return {
    id: row.id,
    userId: row.user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    source: row.source,
    remindAt: row.remind_at,
    offsetMinutes: row.offset_minutes,
    channel: row.channel,
    status: row.status,
    nextAttemptAt: row.next_attempt_at,
    attemptCount: row.attempt_count,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    lastErrorCode: row.last_error_code,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class PgRemindersRepository implements RemindersRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async create(input: CreateReminderRepoInput): Promise<ReminderEntity> {
    const parentColumn = `${input.parentKind}_id` as
      'task_id' | 'habit_id' | 'event_id' | 'subscription_id';
    const values = {
      user_id: input.userId,
      task_id: null,
      habit_id: null,
      event_id: null,
      subscription_id: null,
      source: input.source,
      remind_at: input.remindAt,
      offset_minutes: input.offsetMinutes,
      channel: input.channel,
      // Schema invariant: a pending reminder always has a next_attempt_at, and
      // the dispatcher claims due work through that column.
      next_attempt_at: input.remindAt,
      dedupe_key: input.dedupeKey
    };

    try {
      const inserted = await this.db
        .insertInto('reminders')
        .values({ ...values, [parentColumn]: input.parentId })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toEntity(inserted as unknown as ReminderDbRow);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23503') {
        // FK (parent_id, user_id) rejected: parent does not exist or belongs
        // to another user. Do not reveal which.
        throw AppError.notFound('Parent resource not found');
      }
      if (code === '23505') {
        throw AppError.conflict('CONFLICT', 'A reminder with this dedupeKey already exists');
      }
      throw err;
    }
  }

  public async list(userId: string, filter: ListRemindersFilter): Promise<ReminderEntity[]> {
    let query = this.db.selectFrom('reminders').selectAll().where('user_id', '=', userId);

    if (filter.parentKind && filter.parentId) {
      const parentColumn = `${filter.parentKind}_id` as
        'task_id' | 'habit_id' | 'event_id' | 'subscription_id';
      query = query.where(parentColumn, '=', filter.parentId);
    } else if (filter.parentKind) {
      query = query.where('entity_type', '=', filter.parentKind);
    }
    if (filter.status) {
      query = query.where('status', '=', filter.status);
    }
    if (filter.from) {
      query = query.where('remind_at', '>=', filter.from);
    }
    if (filter.to) {
      query = query.where('remind_at', '<=', filter.to);
    }

    const rows = await query.orderBy('remind_at', 'asc').limit(filter.limit).execute();
    return rows.map((row) => toEntity(row as unknown as ReminderDbRow));
  }

  public async find(userId: string, reminderId: string): Promise<ReminderEntity | null> {
    const row = await this.db
      .selectFrom('reminders')
      .selectAll()
      .where('user_id', '=', userId)
      .where('id', '=', reminderId)
      .executeTakeFirst();
    return row ? toEntity(row as unknown as ReminderDbRow) : null;
  }

  public async update(
    userId: string,
    reminderId: string,
    changes: UpdateReminderRepoInput
  ): Promise<ReminderEntity | null> {
    const values: {
      remind_at?: Date;
      next_attempt_at?: Date;
      offset_minutes?: number | null;
      channel?: 'push' | 'in_app' | 'email';
    } = {};
    if (changes.remindAt !== undefined) {
      values.remind_at = changes.remindAt;
      values.next_attempt_at = changes.remindAt;
    }
    if (changes.offsetMinutes !== undefined) {
      values.offset_minutes = changes.offsetMinutes;
    }
    if (changes.channel !== undefined) {
      values.channel = changes.channel;
    }

    const updated = await this.db
      .updateTable('reminders')
      .set(values)
      .where('user_id', '=', userId)
      .where('id', '=', reminderId)
      .where('source', '=', 'user')
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();
    return updated ? toEntity(updated as unknown as ReminderDbRow) : null;
  }

  public async getParentAnchor(
    userId: string,
    parentKind: ReminderParentKind,
    parentId: string,
    timeZone: string
  ): Promise<Date | null> {
    if (parentKind === 'task') {
      const row = await this.db
        .selectFrom('tasks')
        .select(['due_date', 'due_time', 'status', 'deleted_at'])
        .where('user_id', '=', userId)
        .where('id', '=', parentId)
        .executeTakeFirst();
      if (!row || row.deleted_at || !row.due_date || ['done', 'cancelled'].includes(row.status)) {
        return null;
      }
      return zonedDateTimeToUtc(row.due_date, row.due_time ?? '09:00', timeZone);
    }
    if (parentKind === 'event') {
      const row = await this.db
        .selectFrom('events')
        .select(['start_at', 'deleted_at'])
        .where('user_id', '=', userId)
        .where('id', '=', parentId)
        .executeTakeFirst();
      if (!row || row.deleted_at) {
        return null;
      }
      return row.start_at;
    }
    // Habit and subscription reminders are system-generated in the MVP.
    return null;
  }

  public async delete(userId: string, reminderId: string): Promise<boolean> {
    const deleted = await this.db
      .deleteFrom('reminders')
      .where('user_id', '=', userId)
      .where('id', '=', reminderId)
      .executeTakeFirst();
    return Number(deleted.numDeletedRows) > 0;
  }

  public async cancelPendingFor(parentKind: ReminderParentKind, parentId: string): Promise<number> {
    const parentColumn = `${parentKind}_id` as
      'task_id' | 'habit_id' | 'event_id' | 'subscription_id';
    const updated = await this.db
      .updateTable('reminders')
      .set({ status: 'cancelled', next_attempt_at: null })
      .where(parentColumn, '=', parentId)
      .where('status', 'in', ['pending', 'processing'])
      .executeTakeFirst();
    return Number(updated.numUpdatedRows ?? 0);
  }
}
