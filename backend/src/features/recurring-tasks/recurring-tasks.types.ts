/**
 * src/features/recurring-tasks/recurring-tasks.types.ts
 *
 * Implements Section 6.4 & 14.6: Recurring Tasks Domain Types.
 */

import type { TaskPriority } from '../tasks/tasks.types.js';

export type RecurringTaskStatus = 'active' | 'paused' | 'ended';
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRow {
  id: string;
  user_id: string;
  recurring_task_id: string | null;
  habit_id: string | null;
  freq: RecurrenceFreq;
  interval: number;
  by_weekday: number[] | null;
  by_month_day: number | null;
  by_month: number | null;
  start_date: string;
  end_date: string | null;
  occurrence_limit: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface RecurringTaskRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  priority: number;
  estimate_minutes: number | null;
  due_time: string | null;
  reminder_offset_minutes: number | null;
  status: RecurringTaskStatus;
  generated_through: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

export interface RecurrenceDto {
  id: string;
  freq: RecurrenceFreq;
  interval: number;
  byWeekday: number[] | null;
  byMonthDay: number | null;
  byMonth: number | null;
  startDate: string;
  endDate: string | null;
  occurrenceLimit: number | null;
}

export interface RecurringTaskDto {
  id: string;
  title: string;
  description: string | null;
  projectId: string | null;
  priority: TaskPriority;
  estimateMinutes: number | null;
  dueTime: string | null;
  reminderOffsetMinutes: number | null;
  status: RecurringTaskStatus;
  generatedThrough: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  recurrence: RecurrenceDto;
}
