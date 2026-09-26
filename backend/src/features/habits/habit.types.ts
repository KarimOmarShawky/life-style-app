/**
 * Habit domain types.
 *
 * A habit is a title plus a rhythm. Everything interesting about it — streaks,
 * totals, whether it is done for the current period — is DERIVED from the log
 * rows rather than stored on the habit. Storing a streak counter would mean
 * every write path has to maintain it, and the first path that forgets leaves a
 * number that is wrong forever with no way to notice.
 */

/** Rhythms the database CHECK constraint allows. */
export const HABIT_FREQUENCIES = ['daily', 'weekly', 'custom'] as const;
export type HabitFrequency = (typeof HABIT_FREQUENCIES)[number];

export interface HabitRecord {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly frequency: HabitFrequency;
  readonly isArchived: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A habit plus the numbers computed from its logs in the same query. */
export interface HabitWithStats extends HabitRecord {
  /**
   * Consecutive completed periods ending at the current one or the one before.
   *
   * Null for `custom`, which has no fixed period, so there is nothing for
   * "consecutive" to mean. Reporting 0 there would be a claim; null is the
   * absence of one.
   */
  readonly currentStreak: number | null;
  readonly longestStreak: number | null;
  readonly totalCompletions: number;
  readonly lastCompletedDate: string | null;
  readonly isCompletedForCurrentPeriod: boolean;
}

export interface HabitResponse {
  readonly id: string;
  readonly title: string;
  readonly frequency: HabitFrequency;
  readonly isArchived: boolean;
  readonly currentStreak: number | null;
  readonly longestStreak: number | null;
  readonly totalCompletions: number;
  readonly lastCompletedDate: string | null;
  readonly isCompletedForCurrentPeriod: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HabitLogRecord {
  readonly id: string;
  readonly habitId: string;
  readonly logDate: string;
  readonly completed: boolean;
  readonly createdAt: Date;
}

export interface HabitLogResponse {
  readonly id: string;
  readonly date: string;
  readonly completed: boolean;
}

export interface CreateHabitInput {
  readonly title: string;
  readonly frequency?: HabitFrequency | undefined;
}

export interface UpdateHabitInput {
  readonly title?: string | undefined;
  readonly frequency?: HabitFrequency | undefined;
  readonly isArchived?: boolean | undefined;
}

export interface LogHabitInput {
  readonly date: string;
  readonly completed: boolean;
}

export interface HabitFilters {
  readonly archived: boolean;
}
