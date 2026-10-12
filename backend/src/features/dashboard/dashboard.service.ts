/**
 * src/features/dashboard/dashboard.service.ts
 *
 * Implements Section 14 (P1-05): the dashboard overview. Composition over
 * read-only Reader interfaces only (feature-architecture rule 2).
 */

import type { Clock } from '../../core/time/clock.js';
import { getUserTodayDate, addDaysToDateString } from '../../core/time/date-utils.js';
import type { TaskReader } from '../tasks/tasks.reader.js';
import type { HabitReader } from '../habits/habits.reader.js';
import type { CalendarReader } from '../calendar/calendar.reader.js';
import type { MoneyReader } from '../money/money.reader.js';
import type { TimerReader } from '../timer-sessions/timer-sessions.reader.js';
import type { DashboardOverview } from './dashboard.types.js';

export class DashboardService {
  constructor(
    private readonly tasks: TaskReader,
    private readonly habits: HabitReader,
    private readonly calendar: CalendarReader,
    private readonly money: MoneyReader,
    private readonly timers: TimerReader,
    private readonly clock: Clock
  ) {}

  public async getOverview(userId: string, timezone: string): Promise<DashboardOverview> {
    const date = getUserTodayDate(timezone, this.clock.now());
    const in7 = addDaysToDateString(date, 7);

    const [dayTasks, dayHabits, events, dueSoon, activeSubscriptions, activeTimer, overdue] =
      await Promise.all([
        this.tasks.listForDate(userId, date),
        this.habits.listForDay(userId, date),
        this.calendar.listForDate(userId, date, timezone),
        this.money.listSubscriptionsDueBetween(userId, date, in7),
        this.money.countActiveSubscriptions(userId),
        this.timers.getActive(userId),
        this.tasks.countOverdue(userId, date)
      ]);

    const totalMinorByCurrency: Record<string, number> = {};
    for (const sub of dueSoon) {
      totalMinorByCurrency[sub.currency] =
        (totalMinorByCurrency[sub.currency] ?? 0) + sub.amountMinor;
    }

    return {
      date,
      timezone,
      tasks: {
        dueToday: dayTasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length,
        doneToday: dayTasks.filter((t) => t.status === 'done').length,
        overdue
      },
      habits: {
        dueToday: dayHabits.filter((h) => h.dueOn).length,
        completedToday: dayHabits.filter((h) => h.completedOn).length
      },
      eventsToday: events.length,
      subscriptionsDueNext7Days: {
        count: dueSoon.length,
        totalMinorByCurrency
      },
      activeSubscriptions,
      activeTimer: activeTimer
        ? {
            id: activeTimer.id,
            taskId: activeTimer.taskId,
            startedAt: activeTimer.startedAt
          }
        : null
    };
  }
}
