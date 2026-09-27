/**
 * src/features/habits/habits.repository.pg.ts
 *
 * Implements Section 4.3 & 6.4: PostgreSQL Habits Repository with Kysely.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type { RecurrenceRow } from '../recurring-tasks/recurring-tasks.types.js';
import type {
  HabitsRepository,
  CreateHabitDbInput,
  UpdateHabitDbInput
} from './habits.repository.js';
import type { HabitRow, HabitCheckinRow, HabitStatus, HabitCheckinStatus } from './habits.types.js';

export class PgHabitsRepository implements HabitsRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async createWithRecurrence(
    input: CreateHabitDbInput
  ): Promise<{ habit: HabitRow; recurrence: RecurrenceRow }> {
    return await this.db.transaction().execute(async (trx) => {
      const habit = await trx
        .insertInto('habits')
        .values({
          user_id: input.userId,
          name: input.name,
          description: input.description ?? null,
          status: 'active',
          start_date: input.startDate,
          reminder_time: input.reminderTime ?? null,
          color: input.color ?? null,
          goal_id: input.goalId ?? null
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const recurrence = await trx
        .insertInto('recurrences')
        .values({
          user_id: input.userId,
          recurring_task_id: null,
          habit_id: habit.id,
          freq: input.recurrence.freq,
          interval: input.recurrence.interval ?? 1,
          by_weekday: input.recurrence.byWeekday ?? null,
          by_month_day: null,
          by_month: null,
          start_date: input.startDate,
          end_date: null,
          occurrence_limit: null
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        habit: habit as unknown as HabitRow,
        recurrence: recurrence as unknown as RecurrenceRow
      };
    });
  }

  async findById(
    userId: string,
    id: string
  ): Promise<{ habit: HabitRow; recurrence: RecurrenceRow } | null> {
    const habit = await this.db
      .selectFrom('habits')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!habit) return null;

    const recurrence = await this.db
      .selectFrom('recurrences')
      .selectAll()
      .where('habit_id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!recurrence) return null;

    return {
      habit: habit as unknown as HabitRow,
      recurrence: recurrence as unknown as RecurrenceRow
    };
  }

  async findActiveById(
    userId: string,
    id: string
  ): Promise<{ habit: HabitRow; recurrence: RecurrenceRow } | null> {
    const habit = await this.db
      .selectFrom('habits')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (!habit) return null;

    const recurrence = await this.db
      .selectFrom('recurrences')
      .selectAll()
      .where('habit_id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!recurrence) return null;

    return {
      habit: habit as unknown as HabitRow,
      recurrence: recurrence as unknown as RecurrenceRow
    };
  }

  async update(
    userId: string,
    id: string,
    input: UpdateHabitDbInput,
    expectedVersion?: number
  ): Promise<{ habit: HabitRow; recurrence: RecurrenceRow } | null> {
    return await this.db.transaction().execute(async (trx) => {
      let query = trx
        .updateTable('habits')
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.reminderTime !== undefined ? { reminder_time: input.reminderTime } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.goalId !== undefined ? { goal_id: input.goalId } : {}),
          updated_at: new Date(),
          version: sql<number>`version + 1`
        })
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .where('deleted_at', 'is', null);

      if (expectedVersion !== undefined) {
        query = query.where('version', '=', expectedVersion);
      }

      const updatedHabit = await query.returningAll().executeTakeFirst();
      if (!updatedHabit) return null;

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
            updated_at: new Date()
          })
          .where('habit_id', '=', id)
          .where('user_id', '=', userId)
          .execute();
      }

      const recurrence = await trx
        .selectFrom('recurrences')
        .selectAll()
        .where('habit_id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();

      return {
        habit: updatedHabit as unknown as HabitRow,
        recurrence: recurrence as unknown as RecurrenceRow
      };
    });
  }

  async softDelete(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .updateTable('habits')
      .set({
        deleted_at: new Date(),
        updated_at: new Date()
      })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows ?? 0) > 0) {
      await this.cancelRemindersForHabit(userId, id);
      return true;
    }
    return false;
  }

  async restore(userId: string, id: string, maxAgeDays = 30): Promise<HabitRow | null> {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    const result = await this.db
      .updateTable('habits')
      .set({
        deleted_at: null,
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is not', null)
      .where('deleted_at', '>=', cutoff)
      .returningAll()
      .executeTakeFirst();

    return (result as unknown as HabitRow) ?? null;
  }

  async list(
    userId: string,
    status?: HabitStatus,
    limit = 25,
    cursor?: string
  ): Promise<{
    items: Array<{ habit: HabitRow; recurrence: RecurrenceRow }>;
    nextCursor: string | null;
  }> {
    let query = this.db
      .selectFrom('habits')
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

    const habitIds = items.map((h) => h.id);
    let recurrences: RecurrenceRow[] = [];
    if (habitIds.length > 0) {
      const recRows = await this.db
        .selectFrom('recurrences')
        .selectAll()
        .where('habit_id', 'in', habitIds)
        .where('user_id', '=', userId)
        .execute();
      recurrences = recRows as unknown as RecurrenceRow[];
    }

    const recurrenceMap = new Map<string, RecurrenceRow>();
    for (const r of recurrences) {
      if (r.habit_id) {
        recurrenceMap.set(r.habit_id, r);
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
      .filter((h) => recurrenceMap.has(h.id))
      .map((h) => ({
        habit: h as unknown as HabitRow,
        recurrence: recurrenceMap.get(h.id)!
      }));

    return {
      items: paired,
      nextCursor
    };
  }

  async upsertCheckin(
    userId: string,
    habitId: string,
    checkinDate: string,
    status: HabitCheckinStatus,
    note?: string | null
  ): Promise<HabitCheckinRow> {
    const result = await sql<HabitCheckinRow>`
      INSERT INTO habit_checkins (user_id, habit_id, checkin_date, status, note)
      VALUES (${userId}, ${habitId}, ${checkinDate}, ${status}, ${note ?? null})
      ON CONFLICT (habit_id, checkin_date)
      DO UPDATE SET
        status = EXCLUDED.status,
        note = EXCLUDED.note,
        updated_at = NOW()
      RETURNING *
    `.execute(this.db);

    return result.rows[0]!;
  }

  async deleteCheckin(userId: string, habitId: string, checkinDate: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('habit_checkins')
      .where('user_id', '=', userId)
      .where('habit_id', '=', habitId)
      .where('checkin_date', '=', checkinDate)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0) > 0;
  }

  async getCheckinsForHabit(
    userId: string,
    habitId: string,
    from?: string,
    to?: string
  ): Promise<HabitCheckinRow[]> {
    let query = this.db
      .selectFrom('habit_checkins')
      .selectAll()
      .where('user_id', '=', userId)
      .where('habit_id', '=', habitId);

    if (from) {
      query = query.where('checkin_date', '>=', from);
    }
    if (to) {
      query = query.where('checkin_date', '<=', to);
    }

    const rows = await query.orderBy('checkin_date', 'asc').execute();
    return rows as unknown as HabitCheckinRow[];
  }

  async getAllCheckinsForHabits(userId: string, habitIds: string[]): Promise<HabitCheckinRow[]> {
    if (habitIds.length === 0) return [];

    const rows = await this.db
      .selectFrom('habit_checkins')
      .selectAll()
      .where('user_id', '=', userId)
      .where('habit_id', 'in', habitIds)
      .orderBy('checkin_date', 'asc')
      .execute();

    return rows as unknown as HabitCheckinRow[];
  }

  async cancelRemindersForHabit(userId: string, habitId: string): Promise<void> {
    await this.db
      .updateTable('reminders')
      .set({
        status: 'cancelled',
        updated_at: new Date()
      })
      .where('user_id', '=', userId)
      .where('habit_id', '=', habitId)
      .where('status', '=', 'pending')
      .execute();
  }
}
