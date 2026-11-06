/**
 * src/features/analytics/analytics.service.ts
 *
 * Aggregates the authenticated user's real activity for the Analytics
 * screen. All counts come from PostgreSQL rows owned by that user;
 * there are no sample or demo numbers anywhere in this path.
 *
 * Definitions (kept honest and documented in docs/api/openapi.yaml):
 * - tasks.completedInRange: tasks whose completed_at falls in the range
 *   (user-local dates), tasks.createdInRange likewise by created_at.
 * - habits.checkinsDoneInRange: habit_checkins with status 'done'.
 * - habits.consistencyPercent: completed / due over scheduled days,
 *   evaluated per day through the HabitReader recurrence logic. Only
 *   computed for ranges <= 31 days; longer ranges return null.
 * - focus: timer sessions that ended in the range (running sessions are
 *   excluded because their duration is not final yet).
 * - goals.averageNumericProgressPercent: mean of min(current/target, 1)
 *   over active numeric goals; null when the user has none.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type { Clock } from '../../core/time/clock.js';
import {
  addDaysToDateString,
  formatDateOnly,
  getDayBoundsUtc,
  getUserTodayDate
} from '../../core/time/date-utils.js';
import type { HabitReader } from '../habits/habits.reader.js';
import type { MoneyReader } from '../money/money.reader.js';
import type { TaskReader } from '../tasks/tasks.reader.js';
import type { AnalyticsSeriesPoint, AnalyticsSummary } from './analytics.types.js';

/** Rounded percentage, or null when the denominator is not positive. */
export function ratePercent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 10000) / 100;
}

export interface DailyCounts {
  tasksCompleted: number;
  habitCheckins: number;
  focusMinutes: number;
}

/**
 * Buckets per-day counts into the response series: one point per day for
 * ranges up to 31 days, one point per 7-day bucket for longer ranges.
 */
export function buildSeries(
  from: string,
  days: number,
  daily: ReadonlyMap<string, DailyCounts>
): AnalyticsSeriesPoint[] {
  const bucketSize = days <= 31 ? 1 : 7;
  const points: AnalyticsSeriesPoint[] = [];
  for (let index = 0; index < days; index += 1) {
    const date = addDaysToDateString(from, index);
    const counts = daily.get(date) ?? { tasksCompleted: 0, habitCheckins: 0, focusMinutes: 0 };
    if (index % bucketSize === 0) {
      points.push({ date, ...counts });
    } else {
      const bucket = points[points.length - 1]!;
      bucket.tasksCompleted += counts.tasksCompleted;
      bucket.habitCheckins += counts.habitCheckins;
      bucket.focusMinutes = Math.round((bucket.focusMinutes + counts.focusMinutes) * 10) / 10;
    }
  }
  return points;
}

function validTimezone(timezone: string): string {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

export class AnalyticsService {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly tasks: TaskReader,
    private readonly habits: HabitReader,
    private readonly money: MoneyReader,
    private readonly clock: Clock
  ) {}

  public async getSummary(
    userId: string,
    timezoneInput: string,
    rangeDays: number
  ): Promise<AnalyticsSummary> {
    const timezone = validTimezone(timezoneInput || 'UTC');
    const today = getUserTodayDate(timezone, this.clock.now());
    const from = addDaysToDateString(today, -(rangeDays - 1));
    const startUtc = getDayBoundsUtc(from, timezone).startOfDayUtc;
    const endUtc = getDayBoundsUtc(addDaysToDateString(today, 1), timezone).startOfDayUtc;
    const in7 = addDaysToDateString(today, 7);

    const count = async (promise: Promise<{ count: unknown } | undefined>) =>
      Number((await promise)?.count ?? 0);

    const [
      tasksCompleted,
      tasksCreated,
      tasksPending,
      tasksOverdue,
      habitCheckins,
      activeHabits,
      focusAggregate,
      goalsActive,
      goalsAchievedTotal,
      goalsAchievedInRange,
      numericGoals,
      activeSubscriptions,
      dueSoon,
      dailyTaskRows,
      dailyCheckinRows,
      dailyFocusRows
    ] = await Promise.all([
      count(
        this.db
          .selectFrom('tasks')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('user_id', '=', userId)
          .where('deleted_at', 'is', null)
          .where('status', '=', 'done')
          .where('completed_at', '>=', startUtc)
          .where('completed_at', '<', endUtc)
          .executeTakeFirst()
      ),
      count(
        this.db
          .selectFrom('tasks')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('user_id', '=', userId)
          .where('deleted_at', 'is', null)
          .where('created_at', '>=', startUtc)
          .where('created_at', '<', endUtc)
          .executeTakeFirst()
      ),
      count(
        this.db
          .selectFrom('tasks')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('user_id', '=', userId)
          .where('deleted_at', 'is', null)
          .where('status', 'in', ['todo', 'in_progress'])
          .executeTakeFirst()
      ),
      this.tasks.countOverdue(userId, today),
      count(
        this.db
          .selectFrom('habit_checkins')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('user_id', '=', userId)
          .where('status', '=', 'done')
          .where('checkin_date', '>=', from as never)
          .where('checkin_date', '<=', today as never)
          .executeTakeFirst()
      ),
      count(
        this.db
          .selectFrom('habits')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('user_id', '=', userId)
          .where('status', '=', 'active')
          .where('deleted_at', 'is', null)
          .executeTakeFirst()
      ),
      this.db
        .selectFrom('timer_sessions')
        .select([
          (eb) => eb.fn.countAll<number>().as('sessions'),
          sql<string>`coalesce(sum(extract(epoch from (ended_at - started_at))), 0)`.as('seconds')
        ])
        .where('user_id', '=', userId)
        .where('ended_at', '>=', startUtc)
        .where('ended_at', '<', endUtc)
        .executeTakeFirst(),
      count(
        this.db
          .selectFrom('goals')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('user_id', '=', userId)
          .where('status', '=', 'active')
          .where('deleted_at', 'is', null)
          .executeTakeFirst()
      ),
      count(
        this.db
          .selectFrom('goals')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('user_id', '=', userId)
          .where('status', '=', 'achieved')
          .where('deleted_at', 'is', null)
          .executeTakeFirst()
      ),
      count(
        this.db
          .selectFrom('goals')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('user_id', '=', userId)
          .where('deleted_at', 'is', null)
          .where('achieved_at', '>=', startUtc)
          .where('achieved_at', '<', endUtc)
          .executeTakeFirst()
      ),
      this.db
        .selectFrom('goals')
        .select(['current_value', 'target_value'])
        .where('user_id', '=', userId)
        .where('status', '=', 'active')
        .where('progress_type', '=', 'numeric')
        .where('deleted_at', 'is', null)
        .execute(),
      this.money.countActiveSubscriptions(userId),
      this.money.listSubscriptionsDueBetween(userId, today, in7),
      this.db
        .selectFrom('tasks')
        .select([
          sql<string>`to_char((completed_at at time zone ${timezone})::date, 'YYYY-MM-DD')`.as(
            'day'
          ),
          (eb) => eb.fn.countAll<number>().as('count')
        ])
        .where('user_id', '=', userId)
        .where('deleted_at', 'is', null)
        .where('status', '=', 'done')
        .where('completed_at', '>=', startUtc)
        .where('completed_at', '<', endUtc)
        .groupBy(sql`(completed_at at time zone ${timezone})::date`)
        .execute(),
      this.db
        .selectFrom('habit_checkins')
        .select(['checkin_date', (eb) => eb.fn.countAll<number>().as('count')])
        .where('user_id', '=', userId)
        .where('status', '=', 'done')
        .where('checkin_date', '>=', from as never)
        .where('checkin_date', '<=', today as never)
        .groupBy('checkin_date')
        .execute(),
      this.db
        .selectFrom('timer_sessions')
        .select([
          sql<string>`to_char((ended_at at time zone ${timezone})::date, 'YYYY-MM-DD')`.as('day'),
          sql<string>`coalesce(sum(extract(epoch from (ended_at - started_at))), 0)`.as('seconds')
        ])
        .where('user_id', '=', userId)
        .where('ended_at', '>=', startUtc)
        .where('ended_at', '<', endUtc)
        .groupBy(sql`(ended_at at time zone ${timezone})::date`)
        .execute()
    ]);

    // Habit consistency needs per-day recurrence evaluation; bounded to
    // short ranges so a 12-month request stays cheap and honest (null).
    let consistencyPercent: number | null = null;
    if (rangeDays <= 31) {
      let dueTotal = 0;
      let doneTotal = 0;
      for (let index = 0; index < rangeDays; index += 1) {
        const date = addDaysToDateString(from, index);
        const dayHabits = await this.habits.listForDay(userId, date);
        for (const habit of dayHabits) {
          if (habit.dueOn) {
            dueTotal += 1;
            if (habit.completedOn) doneTotal += 1;
          }
        }
      }
      consistencyPercent = ratePercent(doneTotal, dueTotal);
    }

    let averageNumericProgressPercent: number | null = null;
    if (numericGoals.length > 0) {
      let sum = 0;
      let usable = 0;
      for (const goal of numericGoals) {
        const target = Number(goal.target_value);
        const current = Number(goal.current_value);
        if (Number.isFinite(target) && target > 0 && Number.isFinite(current)) {
          sum += Math.min(Math.max(current / target, 0), 1);
          usable += 1;
        }
      }
      averageNumericProgressPercent = usable > 0 ? Math.round((sum / usable) * 10000) / 100 : null;
    }

    const daily = new Map<string, DailyCounts>();
    const ensure = (date: string): DailyCounts => {
      const existing = daily.get(date);
      if (existing) return existing;
      const created = { tasksCompleted: 0, habitCheckins: 0, focusMinutes: 0 };
      daily.set(date, created);
      return created;
    };
    for (const row of dailyTaskRows) ensure(row.day).tasksCompleted = Number(row.count);
    for (const row of dailyCheckinRows) {
      const date = formatDateOnly(row.checkin_date as unknown as Date | string);
      if (date) ensure(date).habitCheckins = Number(row.count);
    }
    for (const row of dailyFocusRows) {
      ensure(row.day).focusMinutes = Math.round((Number(row.seconds) / 60) * 10) / 10;
    }

    return {
      rangeDays,
      from,
      to: today,
      timezone,
      tasks: {
        completedInRange: tasksCompleted,
        createdInRange: tasksCreated,
        pendingNow: tasksPending,
        overdueNow: tasksOverdue,
        completionRatePercent: ratePercent(tasksCompleted, tasksCreated)
      },
      habits: {
        activeHabits,
        checkinsDoneInRange: habitCheckins,
        consistencyPercent
      },
      focus: {
        sessionsInRange: Number(focusAggregate?.sessions ?? 0),
        totalMinutes: Math.round((Number(focusAggregate?.seconds ?? 0) / 60) * 10) / 10
      },
      goals: {
        active: goalsActive,
        achievedTotal: goalsAchievedTotal,
        achievedInRange: goalsAchievedInRange,
        averageNumericProgressPercent
      },
      subscriptions: {
        active: activeSubscriptions,
        dueNext7Days: dueSoon.length
      },
      series: buildSeries(from, rangeDays, daily)
    };
  }
}
