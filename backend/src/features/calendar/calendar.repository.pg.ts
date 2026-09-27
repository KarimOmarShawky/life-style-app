/**
 * src/features/calendar/calendar.repository.pg.ts
 *
 * Implements Section 4.3, 6.8 & 14.14–14.15: Calendar Events & Reminders PostgreSQL Repository.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type { CalendarRepository } from './calendar.repository.js';
import type {
  EventEntity,
  ReminderEntity,
  CreateEventInput,
  UpdateEventInput,
  ListEventsFilter
} from './calendar.types.js';

interface EventDbRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: Date;
  end_at: Date;
  all_day: boolean;
  timezone: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

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

function toEventEntity(row: EventDbRow): EventEntity {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.start_at instanceof Date ? row.start_at : new Date(row.start_at),
    endAt: row.end_at instanceof Date ? row.end_at : new Date(row.end_at),
    allDay: row.all_day,
    timezone: row.timezone,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    deletedAt: row.deleted_at
      ? row.deleted_at instanceof Date
        ? row.deleted_at
        : new Date(row.deleted_at)
      : null,
    version: row.version
  };
}

function toReminderEntity(row: ReminderDbRow): ReminderEntity {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    habitId: row.habit_id,
    eventId: row.event_id,
    subscriptionId: row.subscription_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    source: row.source,
    remindAt: row.remind_at instanceof Date ? row.remind_at : new Date(row.remind_at),
    offsetMinutes: row.offset_minutes,
    channel: row.channel,
    status: row.status,
    nextAttemptAt: row.next_attempt_at
      ? row.next_attempt_at instanceof Date
        ? row.next_attempt_at
        : new Date(row.next_attempt_at)
      : null,
    attemptCount: row.attempt_count,
    processingStartedAt: row.processing_started_at
      ? row.processing_started_at instanceof Date
        ? row.processing_started_at
        : new Date(row.processing_started_at)
      : null,
    sentAt: row.sent_at
      ? row.sent_at instanceof Date
        ? row.sent_at
        : new Date(row.sent_at)
      : null,
    failedAt: row.failed_at
      ? row.failed_at instanceof Date
        ? row.failed_at
        : new Date(row.failed_at)
      : null,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)
  };
}

export class PgCalendarRepository implements CalendarRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async createEvent(
    userId: string,
    input: CreateEventInput,
    processedReminders?: Array<{
      channel: 'push' | 'in_app' | 'email';
      remindAt: Date;
      offsetMinutes: number | null;
    }>
  ): Promise<{ event: EventEntity; reminders: ReminderEntity[] }> {
    return await this.db.transaction().execute(async (trx) => {
      const startAtDate = new Date(input.startAt);
      const endAtDate = new Date(input.endAt);

      const eventRow = (await trx
        .insertInto('events')
        .values({
          user_id: userId,
          title: input.title,
          description: input.description ?? null,
          location: input.location ?? null,
          start_at: startAtDate,
          end_at: endAtDate,
          all_day: input.allDay ?? false,
          timezone: input.timezone
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as unknown as EventDbRow;

      const reminders: ReminderEntity[] = [];

      if (processedReminders && processedReminders.length > 0) {
        for (const r of processedReminders) {
          const remRow = (await trx
            .insertInto('reminders')
            .values({
              user_id: userId,
              event_id: eventRow.id,
              source: 'user',
              remind_at: r.remindAt,
              offset_minutes: r.offsetMinutes,
              channel: r.channel,
              next_attempt_at: r.remindAt,
              status: 'pending'
            })
            .returningAll()
            .executeTakeFirstOrThrow()) as unknown as ReminderDbRow;

          reminders.push(toReminderEntity(remRow));
        }
      }

      return {
        event: toEventEntity(eventRow),
        reminders
      };
    });
  }

  async findEventById(userId: string, eventId: string): Promise<EventEntity | null> {
    const row = (await this.db
      .selectFrom('events')
      .selectAll()
      .where('id', '=', eventId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()) as unknown as EventDbRow | undefined;

    return row ? toEventEntity(row) : null;
  }

  async findEventByIdWithDeleted(userId: string, eventId: string): Promise<EventEntity | null> {
    const row = (await this.db
      .selectFrom('events')
      .selectAll()
      .where('id', '=', eventId)
      .where('user_id', '=', userId)
      .executeTakeFirst()) as unknown as EventDbRow | undefined;

    return row ? toEventEntity(row) : null;
  }

  async listEvents(userId: string, filter: ListEventsFilter): Promise<EventEntity[]> {
    let query = this.db.selectFrom('events').selectAll().where('user_id', '=', userId);

    if (!filter.includeDeleted) {
      query = query.where('deleted_at', 'is', null);
    }

    if (filter.from) {
      query = query.where('end_at', '>=', new Date(filter.from));
    }

    if (filter.to) {
      query = query.where('start_at', '<=', new Date(filter.to));
    }

    const rows = (await query.orderBy('start_at', 'asc').execute()) as unknown as EventDbRow[];

    return rows.map(toEventEntity);
  }

  async updateEvent(
    userId: string,
    eventId: string,
    input: UpdateEventInput,
    expectedVersion?: number
  ): Promise<EventEntity | null> {
    let query = this.db
      .updateTable('events')
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.startAt !== undefined ? { start_at: new Date(input.startAt) } : {}),
        ...(input.endAt !== undefined ? { end_at: new Date(input.endAt) } : {}),
        ...(input.allDay !== undefined ? { all_day: input.allDay } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', eventId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);

    if (expectedVersion !== undefined) {
      query = query.where('version', '=', expectedVersion);
    }

    const row = (await query.returningAll().executeTakeFirst()) as unknown as
      EventDbRow | undefined;
    return row ? toEventEntity(row) : null;
  }

  async softDeleteEvent(userId: string, eventId: string): Promise<boolean> {
    return await this.db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('events')
        .set({
          deleted_at: new Date(),
          updated_at: new Date(),
          version: sql<number>`version + 1`
        })
        .where('id', '=', eventId)
        .where('user_id', '=', userId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      if (Number(result.numUpdatedRows) === 0) {
        return false;
      }

      await trx
        .updateTable('reminders')
        .set({
          status: 'cancelled',
          updated_at: new Date()
        })
        .where('event_id', '=', eventId)
        .where('user_id', '=', userId)
        .where('status', '=', 'pending')
        .execute();

      return true;
    });
  }

  async restoreEvent(userId: string, eventId: string): Promise<EventEntity | null> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const row = (await this.db
      .updateTable('events')
      .set({
        deleted_at: null,
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', eventId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is not', null)
      .where('deleted_at', '>=', cutoff)
      .returningAll()
      .executeTakeFirst()) as unknown as EventDbRow | undefined;

    return row ? toEventEntity(row) : null;
  }

  async findConflicts(
    userId: string,
    startAt: Date,
    endAt: Date,
    excludeEventId?: string
  ): Promise<EventEntity[]> {
    let query = this.db
      .selectFrom('events')
      .selectAll()
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where('start_at', '<', endAt)
      .where('end_at', '>', startAt);

    if (excludeEventId) {
      query = query.where('id', '!=', excludeEventId);
    }

    const rows = (await query.orderBy('start_at', 'asc').execute()) as unknown as EventDbRow[];

    return rows.map(toEventEntity);
  }

  async listEventsForDay(
    userId: string,
    dayStartUtc: Date,
    dayEndUtc: Date
  ): Promise<EventEntity[]> {
    const rows = (await this.db
      .selectFrom('events')
      .selectAll()
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where('start_at', '<', dayEndUtc)
      .where('end_at', '>=', dayStartUtc)
      .orderBy('start_at', 'asc')
      .execute()) as unknown as EventDbRow[];

    return rows.map(toEventEntity);
  }

  async addReminderToEvent(
    userId: string,
    eventId: string,
    reminder: {
      channel: 'push' | 'in_app' | 'email';
      remindAt: Date;
      offsetMinutes: number | null;
    }
  ): Promise<ReminderEntity> {
    const row = (await this.db
      .insertInto('reminders')
      .values({
        user_id: userId,
        event_id: eventId,
        source: 'user',
        remind_at: reminder.remindAt,
        offset_minutes: reminder.offsetMinutes,
        channel: reminder.channel,
        next_attempt_at: reminder.remindAt,
        status: 'pending'
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as unknown as ReminderDbRow;

    return toReminderEntity(row);
  }

  async listRemindersForEvent(userId: string, eventId: string): Promise<ReminderEntity[]> {
    const rows = (await this.db
      .selectFrom('reminders')
      .selectAll()
      .where('event_id', '=', eventId)
      .where('user_id', '=', userId)
      .where('status', '!=', 'cancelled')
      .orderBy('remind_at', 'asc')
      .execute()) as unknown as ReminderDbRow[];

    return rows.map(toReminderEntity);
  }

  async deleteReminder(userId: string, eventId: string, reminderId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('reminders')
      .set({
        status: 'cancelled',
        updated_at: new Date()
      })
      .where('id', '=', reminderId)
      .where('event_id', '=', eventId)
      .where('user_id', '=', userId)
      .where('status', '!=', 'cancelled')
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async findReminderById(userId: string, reminderId: string): Promise<ReminderEntity | null> {
    const row = (await this.db
      .selectFrom('reminders')
      .selectAll()
      .where('id', '=', reminderId)
      .where('user_id', '=', userId)
      .executeTakeFirst()) as unknown as ReminderDbRow | undefined;

    return row ? toReminderEntity(row) : null;
  }
}
