/** Database record to client response (spec section 35). */
import type {
  HabitLogRecord,
  HabitLogResponse,
  HabitResponse,
  HabitWithStats,
} from './habit.types';

export function toHabitResponse(record: HabitWithStats): HabitResponse {
  return {
    id: record.id,
    title: record.title,
    frequency: record.frequency,
    isArchived: record.isArchived,
    currentStreak: record.currentStreak,
    longestStreak: record.longestStreak,
    totalCompletions: record.totalCompletions,
    lastCompletedDate: record.lastCompletedDate,
    isCompletedForCurrentPeriod: record.isCompletedForCurrentPeriod,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toHabitLogResponse(record: HabitLogRecord): HabitLogResponse {
  return {
    id: record.id,
    date: record.logDate,
    completed: record.completed,
  };
}
