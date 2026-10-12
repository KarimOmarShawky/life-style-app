/**
 * src/features/days/days.service.ts
 *
 * Implements Section 14 (P1-05): Daily Plan composition. All data comes from
 * read-only Reader interfaces; this service never queries other features'
 * tables directly.
 */

import type { Clock } from '../../core/time/clock.js';
import { getUserTodayDate } from '../../core/time/date-utils.js';
import type { TaskReader } from '../tasks/tasks.reader.js';
import type { HabitReader } from '../habits/habits.reader.js';
import type { CalendarReader } from '../calendar/calendar.reader.js';
import type { MoneyReader } from '../money/money.reader.js';
import type { TimerReader } from '../timer-sessions/timer-sessions.reader.js';
import type { DayView } from './days.types.js';

export class DaysService {
  constructor(
    private readonly tasks: TaskReader,
    private readonly habits: HabitReader,
    private readonly calendar: CalendarReader,
    private readonly money: MoneyReader,
    private readonly timers: TimerReader,
    private readonly clock: Clock
  ) {}

  public async getToday(userId: string, timezone: string): Promise<DayView> {
    const date = getUserTodayDate(timezone, this.clock.now());
    return this.getDay(userId, date, timezone);
  }

  public async getDay(userId: string, date: string, timezone: string): Promise<DayView> {
    const [tasks, habits, events, subscriptionsDue, activeTimer] = await Promise.all([
      this.tasks.listForDate(userId, date),
      this.habits.listForDay(userId, date),
      this.calendar.listForDate(userId, date, timezone),
      this.money.listSubscriptionsDueBetween(userId, date, date),
      this.timers.getActive(userId)
    ]);

    return {
      date,
      timezone,
      tasks,
      habits: habits.filter((h) => h.dueOn || h.completedOn),
      events,
      subscriptionsDue,
      activeTimer
    };
  }
}
