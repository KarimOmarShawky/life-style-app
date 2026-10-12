/**
 * src/features/habits/habits.reader.ts
 *
 * Read-only cross-feature interface for the habits domain (feature-architecture
 * rule 2).
 */

import { type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import { computeOccurrences, type RecurrenceRule } from '../recurring-tasks/recurrence-engine.js';
import { formatDateOnly } from '../../core/time/date-utils.js';

export interface HabitReaderItem {
  id: string;
  name: string;
  color: string | null;
  reminderTime: string | null;
  status: string;
  completedOn: boolean;
  dueOn: boolean;
}

export interface HabitReader {
  listForDay(userId: string, date: string): Promise<HabitReaderItem[]>;
  search(userId: string, q: string, limit: number): Promise<HabitReaderItem[]>;
}

export class PgHabitReader implements HabitReader {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async listForDay(userId: string, date: string): Promise<HabitReaderItem[]> {
    const habits = await this.db
      .selectFrom('habits')
      .leftJoin('recurrences', 'recurrences.habit_id', 'habits.id')
      .select([
        'habits.id as id',
        'habits.name as name',
        'habits.color as color',
        'habits.reminder_time as reminder_time',
        'habits.status as status',
        'recurrences.freq as freq',
        'recurrences.interval as interval',
        'recurrences.by_weekday as by_weekday',
        'recurrences.by_month_day as by_month_day',
        'recurrences.by_month as by_month',
        'recurrences.start_date as start_date',
        'recurrences.end_date as end_date',
        'recurrences.occurrence_limit as occurrence_limit'
      ])
      .where('habits.user_id', '=', userId)
      .where('habits.status', '=', 'active')
      .where('habits.deleted_at', 'is', null)
      .execute();

    const checkins = await this.db
      .selectFrom('habit_checkins')
      .select(['habit_id'])
      .where('user_id', '=', userId)
      .where('checkin_date', '=', date as never)
      .where('status', '=', 'done')
      .execute();
    const completedIds = new Set(checkins.map((c) => c.habit_id));

    return habits.map((row) => {
      let dueOn = true;
      if (row.freq && row.start_date) {
        const rule: RecurrenceRule = {
          freq: row.freq,
          interval: row.interval ?? 1,
          byWeekday: row.by_weekday,
          byMonthDay: row.by_month_day,
          byMonth: row.by_month,
          startDate: formatDateOnly(row.start_date)!,
          endDate: formatDateOnly(row.end_date),
          occurrenceLimit: row.occurrence_limit
        };
        dueOn = computeOccurrences(rule, date, date).length > 0;
      }
      return {
        id: row.id,
        name: row.name,
        color: row.color,
        reminderTime: row.reminder_time,
        status: row.status,
        completedOn: completedIds.has(row.id),
        dueOn
      };
    });
  }

  public async search(userId: string, q: string, limit: number): Promise<HabitReaderItem[]> {
    const rows = await this.db
      .selectFrom('habits')
      .select(['id', 'name', 'color', 'reminder_time', 'status'])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where('name', 'ilike', `%${q}%`)
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      reminderTime: row.reminder_time,
      status: row.status,
      completedOn: false,
      dueOn: true
    }));
  }
}
