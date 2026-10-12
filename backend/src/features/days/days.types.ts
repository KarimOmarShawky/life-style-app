/**
 * src/features/days/days.types.ts
 *
 * Implements Section 14 (P1-05): the Daily Plan view — one screen composed
 * from read-only Reader interfaces (feature-architecture rule 2).
 */

import type { TaskReaderItem } from '../tasks/tasks.reader.js';
import type { HabitReaderItem } from '../habits/habits.reader.js';
import type { EventReaderItem } from '../calendar/calendar.reader.js';
import type { SubscriptionReaderItem } from '../money/money.reader.js';
import type { ActiveTimerItem } from '../timer-sessions/timer-sessions.reader.js';

export interface DayView {
  date: string;
  timezone: string;
  tasks: TaskReaderItem[];
  habits: HabitReaderItem[];
  events: EventReaderItem[];
  subscriptionsDue: SubscriptionReaderItem[];
  activeTimer: ActiveTimerItem | null;
}
