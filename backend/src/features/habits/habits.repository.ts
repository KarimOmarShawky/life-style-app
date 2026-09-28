/**
 * src/features/habits/habits.repository.ts
 *
 * Implements Section 4.3 & 6.4: Habits Repository Interface.
 */

import type { RecurrenceRow } from '../recurring-tasks/recurring-tasks.types.js';
import type { HabitRow, HabitCheckinRow, HabitStatus, HabitCheckinStatus } from './habits.types.js';

export interface CreateHabitDbInput {
  userId: string;
  name: string;
  description?: string | null | undefined;
  startDate: string;
  reminderTime?: string | null | undefined;
  color?: string | null | undefined;
  goalId?: string | null | undefined;
  recurrence: {
    freq: 'daily' | 'weekly';
    interval?: number | undefined;
    byWeekday?: number[] | null | undefined;
  };
}

export interface UpdateHabitDbInput {
  name?: string | undefined;
  description?: string | null | undefined;
  status?: HabitStatus | undefined;
  reminderTime?: string | null | undefined;
  color?: string | null | undefined;
  goalId?: string | null | undefined;
  recurrence?:
    | {
        freq?: 'daily' | 'weekly' | undefined;
        interval?: number | undefined;
        byWeekday?: number[] | null | undefined;
      }
    | undefined;
}

export interface HabitsRepository {
  createWithRecurrence(
    input: CreateHabitDbInput
  ): Promise<{ habit: HabitRow; recurrence: RecurrenceRow }>;

  findById(
    userId: string,
    id: string
  ): Promise<{ habit: HabitRow; recurrence: RecurrenceRow } | null>;

  findActiveById(
    userId: string,
    id: string
  ): Promise<{ habit: HabitRow; recurrence: RecurrenceRow } | null>;

  update(
    userId: string,
    id: string,
    input: UpdateHabitDbInput,
    expectedVersion?: number | undefined
  ): Promise<{ habit: HabitRow; recurrence: RecurrenceRow } | null>;

  softDelete(userId: string, id: string): Promise<boolean>;

  restore(userId: string, id: string, maxAgeDays?: number | undefined): Promise<HabitRow | null>;

  list(
    userId: string,
    status?: HabitStatus | undefined,
    limit?: number | undefined,
    cursor?: string | undefined
  ): Promise<{
    items: Array<{ habit: HabitRow; recurrence: RecurrenceRow }>;
    nextCursor: string | null;
  }>;

  upsertCheckin(
    userId: string,
    habitId: string,
    checkinDate: string,
    status: HabitCheckinStatus,
    note?: string | null | undefined
  ): Promise<HabitCheckinRow>;

  deleteCheckin(userId: string, habitId: string, checkinDate: string): Promise<boolean>;

  getCheckinsForHabit(
    userId: string,
    habitId: string,
    from?: string | undefined,
    to?: string | undefined
  ): Promise<HabitCheckinRow[]>;

  getAllCheckinsForHabits(userId: string, habitIds: string[]): Promise<HabitCheckinRow[]>;

  cancelRemindersForHabit(userId: string, habitId: string): Promise<void>;
}
