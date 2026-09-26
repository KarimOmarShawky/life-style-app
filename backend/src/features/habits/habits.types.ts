/**
 * src/features/habits/habits.types.ts
 *
 * Implements Section 6.5 & 14.8: Habits & Habit Check-ins domain types.
 */

export interface HabitEntity {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'archived';
  startDate: string;
  reminderTime: string | null;
  color: string | null;
  goalId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface HabitCheckinEntity {
  id: string;
  userId: string;
  habitId: string;
  checkinDate: string;
  status: 'done' | 'skipped';
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}
