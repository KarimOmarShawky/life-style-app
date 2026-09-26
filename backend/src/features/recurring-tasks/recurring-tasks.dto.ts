/**
 * src/features/recurring-tasks/recurring-tasks.dto.ts
 *
 * Implements Section 14.6: Recurring Tasks DTO Serialization.
 */

import { priorityToString } from '../tasks/tasks.dto.js';
import type {
  RecurringTaskRow,
  RecurrenceRow,
  RecurringTaskDto,
  RecurrenceDto
} from './recurring-tasks.types.js';

function formatIso(val: Date | string | null): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString();
  }
  return new Date(val).toISOString();
}

function formatTime(val: string | null): string | null {
  if (!val) return null;
  return val.slice(0, 5);
}

function formatDateOnly(val: Date | string | null): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return val.slice(0, 10);
}

export function toRecurrenceDto(row: RecurrenceRow): RecurrenceDto {
  return {
    id: row.id,
    freq: row.freq,
    interval: row.interval,
    byWeekday: row.by_weekday,
    byMonthDay: row.by_month_day,
    byMonth: row.by_month,
    startDate: formatDateOnly(row.start_date)!,
    endDate: formatDateOnly(row.end_date),
    occurrenceLimit: row.occurrence_limit
  };
}

export function toRecurringTaskDto(
  taskRow: RecurringTaskRow,
  recurrenceRow: RecurrenceRow
): RecurringTaskDto {
  return {
    id: taskRow.id,
    title: taskRow.title,
    description: taskRow.description,
    projectId: taskRow.project_id,
    priority: priorityToString(taskRow.priority),
    estimateMinutes: taskRow.estimate_minutes,
    dueTime: formatTime(taskRow.due_time),
    reminderOffsetMinutes: taskRow.reminder_offset_minutes,
    status: taskRow.status,
    generatedThrough: formatDateOnly(taskRow.generated_through),
    createdAt: formatIso(taskRow.created_at)!,
    updatedAt: formatIso(taskRow.updated_at)!,
    version: taskRow.version,
    recurrence: toRecurrenceDto(recurrenceRow)
  };
}
