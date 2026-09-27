/**
 * src/features/habits/habits.types.ts
 *
 * Implements Section 6.4 & 14.8: Habits Domain Types.
 */

export type HabitStatus = 'active' | 'paused' | 'archived';
export type HabitCheckinStatus = 'done' | 'skipped';

export interface HabitRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: HabitStatus;
  start_date: Date | string;
  reminder_time: string | null;
  color: string | null;
  goal_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

export interface HabitCheckinRow {
  id: string;
  user_id: string;
  habit_id: string;
  checkin_date: Date | string;
  status: HabitCheckinStatus;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface HabitRecurrenceDto {
  id: string;
  freq: 'daily' | 'weekly';
  interval: number;
  byWeekday: number[] | null;
  startDate: string;
}

export interface HabitDto {
  id: string;
  name: string;
  description: string | null;
  status: HabitStatus;
  startDate: string;
  reminderTime: string | null;
  color: string | null;
  goalId: string | null;
  recurrence: HabitRecurrenceDto;
  currentStreak: number;
  longestStreak: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface HabitCheckinDto {
  id: string;
  habitId: string;
  checkinDate: string;
  status: HabitCheckinStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
