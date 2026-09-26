/**
 * src/features/habits/habits.repository.ts
 *
 * Implements Section 4.3 & 6.5: Habits Repository Interface.
 */

import type { HabitEntity, HabitCheckinEntity } from './habits.types.js';

export interface HabitsRepository {
  findHabitById(userId: string, habitId: string): Promise<HabitEntity | null>;
  findCheckin(
    userId: string,
    habitId: string,
    checkinDate: string
  ): Promise<HabitCheckinEntity | null>;
}
