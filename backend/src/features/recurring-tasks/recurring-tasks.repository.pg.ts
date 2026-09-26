/**
 * src/features/recurring-tasks/recurring-tasks.repository.pg.ts
 *
 * Implements Section 4.3 & 6.4: PostgreSQL Recurring Tasks Repository with Kysely.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type {
  RecurringTasksRepository,
  CreateRecurringTaskDbInput,
  UpdateRecurringTaskDbInput
} from './recurring-tasks.repository.js';
import type {
  RecurringTaskRow,
  RecurrenceRow,
  RecurringTaskStatus
} from './recurring-tasks.types.js';
import { computeOccurrences } from './recurrence-engine.js';
import { addDaysToDateString } from '../../core/time/date-utils.js';

export class PgRecurringTasksRepository implements RecurringTasksRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async createWithRecurrence(
    input: CreateRecurringTaskDbInput,
    userToday: string
  ): Promise<{ recurringTask: RecurringTaskRow; recurrence: RecurrenceRow }> {
    return await this.db.transaction().execute(async (trx) => {
      // 1. Calculate generation horizon (userToday -> userToday + 7 days)
      const windowStart =
        userToday < input.recurrence.startDate ? input.recurrence.startDate : userToday;
      const windowEnd = addDaysToDateString(userToday, 7);

      // 2. Insert recurring task template
      const recTask = await trx
        .insertInto('recurring_tasks')
        .values({
          user_id: input.userId,
          title: input.title,
          description: input.description ?? null,
          project_id: input.projectId ?? null,
          priority: input.priority ?? 0,
          estimate_minutes: input.estimateMinutes ?? null,
          due_time: input.dueTime ?? null,
          reminder_offset_minutes: input.reminderOffsetMinutes ?? null,
          status: input.status ?? 'active',
          generated_through: windowEnd
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // 3. Insert recurrence rule
      const rec = await trx
        .insertInto('recurrences')
        .values({
          user_id: input.userId,
          recurring_task_id: recTask.id,
          habit_id: null,
          freq: input.recurrence.freq,
          interval: input.recurrence.interval ?? 1,
          by_weekday: input.recurrence.byWeekday ?? null,
          by_month_day: input.recurrence.byMonthDay ?? null,
          by_month: input.recurrence.byMonth ?? null,
          start_date: input.recurrence.startDate,
          end_date: input.recurrence.endDate ?? null,
          occurrence_limit: input.recurrence.occurrenceLimit ?? null
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // 4. Generate first 7 days of instances idempotently (AC-REC-01)
      if ((input.status ?? 'active') === 'active') {
        const occurrences = computeOccurrences(input.recurrence, windowStart, windowEnd);

        if (occurrences.length > 0) {
          const taskRows = occurrences.map((occDate) => ({
            user_id: input.userId,
            title: input.title,
            description: input.description ?? null,
            status: 'todo' as const,
            priority: input.priority ?? 0,
            due_date: occDate,
            due_time: input.dueTime ?? null,
            planned_date: occDate,
            is_focus: false,
            estimate_minutes: input.estimateMinutes ?? null,
            project_id: input.projectId ?? null,
            recurring_task_id: recTask.id,
            occurrence_date: occDate,
            is_customized: false,
            completed_at: null
          }));

          // Bulk insert with ON CONFLICT DO NOTHING for idempotent generation
          await trx
            .insertInto('tasks')
            .values(taskRows)
            .onConflict((oc) =>
              oc
                .columns(['recurring_task_id', 'occurrence_date'])
                .where('recurring_task_id', 'is not', null)
                .doNothing()
            )
            .execute();
        }
      }

      return {
        recurringTask: recTask as unknown as RecurringTaskRow,
        recurrence: rec as unknown as RecurrenceRow
      };
    });
  }

  async findById(
    userId: string,
    id: string
  ): Promise<{ recurringTask: RecurringTaskRow; recurrence: RecurrenceRow } | null> {
    const recTask = await this.db
      .selectFrom('recurring_tasks')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!recTask) return null;

    const recurrence = await this.db
      .selectFrom('recurrences')
      .selectAll()
      .where('recurring_task_id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!recurrence) return null;

    return {
      recurringTask: recTask as unknown as RecurringTaskRow,
      recurrence: recurrence as unknown as RecurrenceRow
    };
  }

  async findActiveById(
    userId: string,
    id: string
  ): Promise<{ recurringTask: RecurringTaskRow; recurrence: RecurrenceRow } | null> {
    const recTask = await this.db
      .selectFrom('recurring_tasks')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (!recTask) return null;

    const recurrence = await this.db
      .selectFrom('recurrences')
      .selectAll()
      .where('recurring_task_id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!recurrence) return null;

    return {
      recurringTask: recTask as unknown as RecurringTaskRow,
      recurrence: recurrence as unknown as RecurrenceRow
    };
  }

  async update(
    userId: string,
    id: string,
    input: UpdateRecurringTaskDbInput,
    userToday: string,
    expectedVersion?: number
  ): Promise<{ recurringTask: RecurringTaskRow; recurrence: RecurrenceRow } | null> {
    return await this.db.transaction().execute(async (trx) => {
      let query = trx
        .updateTable('recurring_tasks')
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.projectId !== undefined ? { project_id: input.projectId } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.estimateMinutes !== undefined
            ? { estimate_minutes: input.estimateMinutes }
            : {}),
          ...(input.dueTime !== undefined ? { due_time: input.dueTime } : {}),
          ...(input.reminderOffsetMinutes !== undefined
            ? { reminder_offset_minutes: input.reminderOffsetMinutes }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updated_at: new Date(),
          version: sql<number>`version + 1`
        })
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .where('deleted_at', 'is', null);

      if (expectedVersion !== undefined) {
        query = query.where('version', '=', expectedVersion);
      }

      const updatedTask = await query.returningAll().executeTakeFirst();
      if (!updatedTask) return null;

      if (input.recurrence) {
        await trx
          .updateTable('recurrences')
          .set({
            ...(input.recurrence.freq !== undefined ? { freq: input.recurrence.freq } : {}),
            ...(input.recurrence.interval !== undefined
              ? { interval: input.recurrence.interval }
              : {}),
            ...(input.recurrence.byWeekday !== undefined
              ? { by_weekday: input.recurrence.byWeekday }
              : {}),
            ...(input.recurrence.byMonthDay !== undefined
              ? { by_month_day: input.recurrence.byMonthDay }
              : {}),
            ...(input.recurrence.byMonth !== undefined
              ? { by_month: input.recurrence.byMonth }
              : {}),
            ...(input.recurrence.startDate !== undefined
              ? { start_date: input.recurrence.startDate }
              : {}),
            ...(input.recurrence.endDate !== undefined
              ? { end_date: input.recurrence.endDate }
              : {}),
            ...(input.recurrence.occurrenceLimit !== undefined
              ? { occurrence_limit: input.recurrence.occurrenceLimit }
              : {}),
            updated_at: new Date()
          })
          .where('recurring_task_id', '=', id)
          .where('user_id', '=', userId)
          .execute();
      }

      const recurrence = await trx
        .selectFrom('recurrences')
        .selectAll()
        .where('recurring_task_id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();

      // AC-REC-02: Updating a recurring template updates only future, non-customized, open instances
      await trx
        .updateTable('tasks')
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.estimateMinutes !== undefined
            ? { estimate_minutes: input.estimateMinutes }
            : {}),
          ...(input.dueTime !== undefined ? { due_time: input.dueTime } : {}),
          ...(input.projectId !== undefined ? { project_id: input.projectId } : {}),
          updated_at: new Date()
        })
        .where('recurring_task_id', '=', id)
        .where('user_id', '=', userId)
        .where('is_customized', '=', false)
        .where('status', 'in', ['todo', 'in_progress'])
        .where('occurrence_date', '>', userToday)
        .where('deleted_at', 'is', null)
        .execute();

      return {
        recurringTask: updatedTask as unknown as RecurringTaskRow,
        recurrence: recurrence as unknown as RecurrenceRow
      };
    });
  }

  async softDelete(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .updateTable('recurring_tasks')
      .set({
        deleted_at: new Date(),
        updated_at: new Date()
      })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0) > 0;
  }

  async list(
    userId: string,
    status?: RecurringTaskStatus,
    limit = 25,
    cursor?: string
  ): Promise<{
    items: Array<{ recurringTask: RecurringTaskRow; recurrence: RecurrenceRow }>;
    nextCursor: string | null;
  }> {
    let query = this.db
      .selectFrom('recurring_tasks')
      .selectAll()
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);

    if (status) {
      query = query.where('status', '=', status);
    }

    query = query.orderBy('created_at', 'desc').orderBy('id', 'desc');

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8');
        const { id: cId, createdAt } = JSON.parse(decoded);
        if (cId && createdAt) {
          const cursorDate = new Date(createdAt);
          query = query.where((eb) =>
            eb.or([
              eb('created_at', '<', cursorDate),
              eb.and([eb('created_at', '=', cursorDate), eb('id', '<', cId)])
            ])
          );
        }
      } catch {
        // ignore invalid cursor
      }
    }

    const rows = await query.limit(limit + 1).execute();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const taskIds = items.map((t) => t.id);
    let recurrences: RecurrenceRow[] = [];
    if (taskIds.length > 0) {
      const recRows = await this.db
        .selectFrom('recurrences')
        .selectAll()
        .where('recurring_task_id', 'in', taskIds)
        .where('user_id', '=', userId)
        .execute();
      recurrences = recRows as unknown as RecurrenceRow[];
    }

    const recurrenceMap = new Map<string, RecurrenceRow>();
    for (const r of recurrences) {
      if (r.recurring_task_id) {
        recurrenceMap.set(r.recurring_task_id, r);
      }
    }

    let nextCursor: string | null = null;
    const lastItem = items.length > 0 ? items[items.length - 1] : undefined;
    if (hasMore && lastItem) {
      const payload = {
        id: lastItem.id,
        createdAt: (lastItem.created_at as Date).toISOString()
      };
      nextCursor = Buffer.from(JSON.stringify(payload)).toString('base64');
    }

    const paired = items
      .filter((t) => recurrenceMap.has(t.id))
      .map((t) => ({
        recurringTask: t as unknown as RecurringTaskRow,
        recurrence: recurrenceMap.get(t.id)!
      }));

    return {
      items: paired,
      nextCursor
    };
  }
}
