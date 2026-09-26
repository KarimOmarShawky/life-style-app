/**
 * Habit persistence.
 *
 * THE STREAK QUERY IS THE FEATURE. Everything else here is ordinary CRUD.
 *
 * A streak is the length of the most recent unbroken run of completed periods.
 * The naive implementation reads a habit's logs into the application and walks
 * them; that is one query per habit, so a page of 20 habits costs 20 extra round
 * trips to a database in another region, and the walk has to be repeated on
 * every read.
 *
 * Instead the whole page is computed in one statement using gaps and islands:
 *
 *   1. Each completed log is reduced to an integer PERIOD INDEX. For a daily
 *      habit that is the day number; for a weekly habit the week number. This is
 *      what lets one piece of SQL serve both rhythms.
 *   2. Duplicate periods collapse, so two logs in the same week count once.
 *   3. `period_index - row_number()` is CONSTANT within a run of consecutive
 *      periods and changes at every gap. Grouping by it turns runs into rows.
 *   4. The longest run is the longest streak. The run whose last period is the
 *      current one, or the one before it, is the current streak.
 *
 * Step 4's tolerance is deliberate: a daily habit not yet done TODAY still has a
 * live streak. Without it every streak would read as zero each morning.
 *
 * Ownership is in the WHERE clause of every statement (DD-008).
 */
import { formatCalendarDate } from '@/core/utils/calendar-date';
import { query } from '@/infrastructure/database/postgres/pool';
import type { Cursor } from '@/core/utils/pagination';

import { PERIOD_INDEX } from './habit.period';

import type {
  CreateHabitInput,
  HabitFrequency,
  HabitLogRecord,
  HabitWithStats,
  LogHabitInput,
  UpdateHabitInput,
} from './habit.types';

interface HabitStatsRow {
  id: string;
  user_id: string;
  title: string;
  frequency: HabitFrequency;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
  current_streak: number | null;
  longest_streak: number | null;
  total_completions: string;
  last_completed_date: Date | null;
  completed_current: boolean;
}

function toRecord(row: HabitStatsRow): HabitWithStats {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    frequency: row.frequency,
    isArchived: row.is_archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    totalCompletions: Number(row.total_completions),
    // A DATE comes back as a Date at local midnight; only the calendar part is
    // meaningful, so it is formatted rather than sent through toISOString, which
    // would shift the day for anyone behind UTC.
    lastCompletedDate: row.last_completed_date ? formatCalendarDate(row.last_completed_date) : null,
    isCompletedForCurrentPeriod: row.completed_current,
  };
}

/**
 * Builds the statistics query around a target predicate.
 *
 * `targetPredicate` and `targetSuffix` are fixed literals written in this file,
 * chosen by the caller from a closed set. No client value is ever interpolated;
 * values arrive as `$n` placeholders (spec section 14).
 *
 * The ORDER BY and LIMIT sit inside the `target` CTE on purpose: narrowing to
 * one page BEFORE the log scan means streaks are computed for the rows being
 * returned, not for every habit the user has ever created.
 */
function statsQuery(targetPredicate: string, targetSuffix: string): string {
  return `
    WITH target AS (
      SELECT h.id, h.user_id, h.title, h.frequency, h.is_archived, h.created_at, h.updated_at,
             ${PERIOD_INDEX('$2::date', 'h.frequency')} AS current_period
        FROM habits h
       WHERE ${targetPredicate}
       ${targetSuffix}
    ),
    logs AS (
      SELECT t.id AS habit_id, t.current_period, hl.log_date, hl.completed,
             ${PERIOD_INDEX('hl.log_date', 't.frequency')} AS period_index
        FROM target t
        JOIN habit_logs hl ON hl.habit_id = t.id
    ),
    -- Two logs in the same week are one completed week.
    completed_periods AS (
      SELECT DISTINCT habit_id, period_index FROM logs WHERE completed
    ),
    -- period_index - row_number() is constant inside a run and jumps at a gap.
    islands AS (
      SELECT habit_id,
             period_index,
             period_index - row_number() OVER (PARTITION BY habit_id ORDER BY period_index)
               AS island
        FROM completed_periods
    ),
    runs AS (
      SELECT habit_id, island, count(*)::int AS run_length, max(period_index) AS last_period
        FROM islands
       GROUP BY habit_id, island
    ),
    streaks AS (
      SELECT r.habit_id,
             max(r.run_length) AS longest_streak,
             -- The run is live if it reaches the current period or the one
             -- before it. Anything older is a broken streak.
             coalesce(
               max(r.run_length) FILTER (WHERE r.last_period >= t.current_period - 1), 0
             ) AS current_streak
        FROM runs r
        JOIN target t ON t.id = r.habit_id
       GROUP BY r.habit_id, t.current_period
    ),
    totals AS (
      SELECT habit_id,
             count(*) FILTER (WHERE completed)::int AS total_completions,
             max(log_date) FILTER (WHERE completed) AS last_completed_date,
             coalesce(bool_or(completed AND period_index = current_period), false)
               AS completed_current
        FROM logs
       GROUP BY habit_id
    )
    SELECT t.id, t.user_id, t.title, t.frequency, t.is_archived, t.created_at, t.updated_at,
           coalesce(tot.total_completions, 0) AS total_completions,
           tot.last_completed_date,
           coalesce(tot.completed_current, false) AS completed_current,
           -- 'custom' has no fixed period, so "consecutive" has no meaning for
           -- it. Null says that; zero would be a claim that the streak is broken.
           CASE WHEN t.frequency = 'custom' THEN NULL
                ELSE coalesce(s.longest_streak, 0) END AS longest_streak,
           CASE WHEN t.frequency = 'custom' THEN NULL
                ELSE coalesce(s.current_streak, 0) END AS current_streak
      FROM target t
      LEFT JOIN totals tot ON tot.habit_id = t.id
      LEFT JOIN streaks s ON s.habit_id = t.id
     ORDER BY t.created_at DESC, t.id DESC`;
}

export async function insertHabit(
  userId: string,
  input: CreateHabitInput,
  asOf: string,
): Promise<HabitWithStats> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO habits (user_id, title, frequency)
     VALUES ($1, $2, coalesce($3, 'daily'))
     RETURNING id`,
    [userId, input.title, input.frequency ?? null],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) {
    throw new Error('INSERT ... RETURNING produced no row');
  }

  const created = await findHabitById(userId, id, asOf);
  if (!created) {
    throw new Error('habit vanished immediately after insert');
  }
  return created;
}

export async function findHabitById(
  userId: string,
  habitId: string,
  asOf: string,
): Promise<HabitWithStats | undefined> {
  const result = await query<HabitStatsRow>(statsQuery('h.user_id = $1 AND h.id = $3', ''), [
    userId,
    asOf,
    habitId,
  ]);

  const row = result.rows[0];
  return row ? toRecord(row) : undefined;
}

export async function listHabits(
  userId: string,
  limit: number,
  cursor: Cursor | undefined,
  archived: boolean,
  asOf: string,
): Promise<HabitWithStats[]> {
  if (cursor) {
    const result = await query<HabitStatsRow>(
      statsQuery(
        'h.user_id = $1 AND h.is_archived = $3 AND (h.created_at, h.id) < ($4, $5)',
        'ORDER BY h.created_at DESC, h.id DESC LIMIT $6',
      ),
      [userId, asOf, archived, cursor.createdAt, cursor.id, limit + 1],
    );
    return result.rows.map(toRecord);
  }

  const result = await query<HabitStatsRow>(
    statsQuery(
      'h.user_id = $1 AND h.is_archived = $3',
      'ORDER BY h.created_at DESC, h.id DESC LIMIT $4',
    ),
    [userId, asOf, archived, limit + 1],
  );
  return result.rows.map(toRecord);
}

export async function updateHabit(
  userId: string,
  habitId: string,
  input: UpdateHabitInput,
  asOf: string,
): Promise<HabitWithStats | undefined> {
  const result = await query<{ id: string }>(
    `UPDATE habits
        SET title       = CASE WHEN $3::boolean THEN $4::text    ELSE title END,
            frequency   = CASE WHEN $5::boolean THEN $6::text    ELSE frequency END,
            is_archived = CASE WHEN $7::boolean THEN $8::boolean ELSE is_archived END
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [
      habitId,
      userId,
      input.title !== undefined,
      input.title ?? null,
      input.frequency !== undefined,
      input.frequency ?? null,
      input.isArchived !== undefined,
      input.isArchived ?? null,
    ],
  );

  if (result.rowCount === 0) {
    return undefined;
  }
  return findHabitById(userId, habitId, asOf);
}

export async function deleteHabit(userId: string, habitId: string): Promise<boolean> {
  const result = await query(`DELETE FROM habits WHERE id = $1 AND user_id = $2`, [
    habitId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Records or updates one day's entry.
 *
 * INSERT ... SELECT is what makes this safe: the row is written only if the
 * SELECT finds a habit belonging to the caller, so ownership is part of the same
 * statement rather than a check that ran a moment earlier.
 *
 * ON CONFLICT makes it idempotent. Two taps on "done" update one row instead of
 * creating two, which is exactly the duplicate the unique index exists to
 * prevent, handled here as a normal outcome rather than an error.
 */
export async function upsertHabitLog(
  userId: string,
  habitId: string,
  input: LogHabitInput,
): Promise<boolean> {
  const result = await query(
    `INSERT INTO habit_logs (habit_id, user_id, log_date, completed)
     SELECT h.id, h.user_id, $3::date, $4
       FROM habits h
      WHERE h.id = $1 AND h.user_id = $2
     ON CONFLICT (habit_id, log_date)
     DO UPDATE SET completed = EXCLUDED.completed`,
    [habitId, userId, input.date, input.completed],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function deleteHabitLog(
  userId: string,
  habitId: string,
  date: string,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM habit_logs WHERE habit_id = $1 AND user_id = $2 AND log_date = $3::date`,
    [habitId, userId, date],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listHabitLogs(
  userId: string,
  habitId: string,
  from: string | undefined,
  to: string | undefined,
  limit: number,
): Promise<HabitLogRecord[]> {
  const result = await query<{
    id: string;
    habit_id: string;
    log_date: Date;
    completed: boolean;
    created_at: Date;
  }>(
    `SELECT id, habit_id, log_date, completed, created_at
       FROM habit_logs
      WHERE habit_id = $1
        AND user_id = $2
        AND ($3::date IS NULL OR log_date >= $3::date)
        AND ($4::date IS NULL OR log_date <= $4::date)
      ORDER BY log_date DESC
      LIMIT $5`,
    [habitId, userId, from ?? null, to ?? null, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    habitId: row.habit_id,
    logDate: formatCalendarDate(row.log_date),
    completed: row.completed,
    createdAt: row.created_at,
  }));
}
