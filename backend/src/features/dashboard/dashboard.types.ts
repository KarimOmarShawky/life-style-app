/**
 * The home summary (FR-24).
 *
 * THIS SLICE IS THE DELIBERATE EXCEPTION TO THE ARCHITECTURE. Every other
 * feature owns its tables; this one owns none and reads seven. That is what a
 * dashboard is — a projection across the whole application — and pretending
 * otherwise would mean either seven round trips assembled in JavaScript, or a
 * feature importing six other features' repositories, which is the coupling
 * vertical slices exist to prevent.
 *
 * The rules that keep it honest:
 *
 *   IT READS, NEVER WRITES. No endpoint here changes anything, so there is no
 *   write path that could get out of step with the feature that owns the table.
 *
 *   IT DOES NOT RE-DERIVE A RULE THAT ALREADY EXISTS. Two questions here have
 *   subtle answers that live elsewhere: which period a habit is in, and which
 *   expenses a budget measures. Both are imported as SQL fragments — from
 *   `habit.period` and `budget.match` — rather than rewritten. A second copy of
 *   either would not fail loudly; it would drift, and the symptom would be a
 *   home screen quietly disagreeing with the screen it summarises.
 *
 *   EVERY NUMBER IS COUNTED AND EVERY LIST IS BOUNDED. The counts are what the
 *   user acts on; the lists are a preview with a cap, and the count says how
 *   much the preview left out.
 *
 * The day is the UTC day, for the same reason all-day events are (DD-024):
 * there is no per-user timezone in the schema, and truncating in the server's
 * local zone would make the same request answer differently on different
 * machines.
 */
import type { TaskPriority, TaskStatus } from '@/features/tasks/task.types';
import type { HabitFrequency } from '@/features/habits/habit.types';
import type { ReminderEntityType } from '@/features/schedule/schedule.types';

/** A task as the home screen shows it: enough to recognise and to act on. */
export interface DashboardTask {
  readonly id: string;
  readonly title: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly dueDate: string;
  readonly isOverdue: boolean;
}

export interface DashboardHabit {
  readonly id: string;
  readonly title: string;
  readonly frequency: HabitFrequency;
}

export interface DashboardEvent {
  readonly id: string;
  readonly title: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly allDay: boolean;
}

export interface DashboardReminder {
  readonly id: string;
  readonly entityType: ReminderEntityType;
  readonly entityId: string;
  readonly entityTitle: string;
  readonly remindAt: string;
}

/** Spending in one currency. Never summed across currencies (DD-021). */
export interface DashboardSpending {
  readonly currency: string;
  readonly today: string;
  readonly month: string;
}

export interface DashboardResponse {
  /** The UTC day this summarises. */
  readonly date: string;
  readonly tasks: {
    readonly overdue: number;
    readonly dueToday: number;
    readonly completedToday: number;
    /** Overdue and due-today tasks, soonest first. Capped; see `overdue + dueToday`. */
    readonly items: readonly DashboardTask[];
  };
  readonly habits: {
    readonly tracked: number;
    /** Satisfied for the period they are currently in, which for a weekly habit is this week. */
    readonly completed: number;
    /** The ones still outstanding. Capped. */
    readonly items: readonly DashboardHabit[];
  };
  readonly events: {
    readonly today: number;
    /** Events overlapping today, earliest first. Capped. */
    readonly items: readonly DashboardEvent[];
  };
  readonly reminders: {
    readonly due: number;
    /** Oldest first, matching the delivery queue exactly. Capped. */
    readonly items: readonly DashboardReminder[];
  };
  readonly money: {
    /** One row per currency the user has spent in this month. */
    readonly spending: readonly DashboardSpending[];
    readonly budgetsOverLimit: number;
  };
  readonly goals: {
    readonly active: number;
    readonly dueSoon: number;
  };
}
