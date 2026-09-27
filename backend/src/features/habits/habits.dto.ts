/**
 * src/features/habits/habits.dto.ts
 *
 * Implements Section 14.8: Habits DTO Serialization.
 */

import type { RecurrenceRow } from '../recurring-tasks/recurring-tasks.types.js';
import type {
  HabitRow,
  HabitCheckinRow,
  HabitDto,
  HabitCheckinDto,
  HabitRecurrenceDto
} from './habits.types.js';

function formatDateOnly(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

function formatIso(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString();
  }
  return new Date(val).toISOString();
}

function formatTime(val: string | null | undefined): string | null {
  if (!val) return null;
  return val.slice(0, 5); // Return HH:mm
}

export function toHabitRecurrenceDto(row: RecurrenceRow): HabitRecurrenceDto {
  return {
    id: row.id,
    freq: row.freq as 'daily' | 'weekly',
    interval: row.interval,
    byWeekday: row.by_weekday,
    startDate: formatDateOnly(row.start_date)!
  };
}

export function toHabitDto(
  habitRow: HabitRow,
  recurrenceRow: RecurrenceRow,
  currentStreak = 0,
  longestStreak = 0
): HabitDto {
  return {
    id: habitRow.id,
    name: habitRow.name,
    description: habitRow.description,
    status: habitRow.status,
    startDate: formatDateOnly(habitRow.start_date)!,
    reminderTime: formatTime(habitRow.reminder_time),
    color: habitRow.color,
    goalId: habitRow.goal_id,
    recurrence: toHabitRecurrenceDto(recurrenceRow),
    currentStreak,
    longestStreak,
    createdAt: formatIso(habitRow.created_at)!,
    updatedAt: formatIso(habitRow.updated_at)!,
    version: habitRow.version
  };
}

export function toHabitCheckinDto(row: HabitCheckinRow): HabitCheckinDto {
  return {
    id: row.id,
    habitId: row.habit_id,
    checkinDate: formatDateOnly(row.checkin_date)!,
    status: row.status,
    note: row.note,
    createdAt: formatIso(row.created_at)!,
    updatedAt: formatIso(row.updated_at)!
  };
}
