/**
 * src/features/tasks/tasks.dto.ts
 *
 * Implements Section 14.4: Task DTO serialization.
 */

import type { TaskRow, TaskDto, TaskPriority } from './tasks.types.js';

export function priorityToString(priority: number): TaskPriority {
  switch (priority) {
    case 1:
      return 'low';
    case 2:
      return 'medium';
    case 3:
      return 'high';
    default:
      return 'none';
  }
}

export function priorityToNumber(priority?: TaskPriority | undefined): number {
  switch (priority) {
    case 'low':
      return 1;
    case 'medium':
      return 2;
    case 'high':
      return 3;
    default:
      return 0;
  }
}

export function formatDateOnly(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

export function formatIso(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString();
  }
  return new Date(val).toISOString();
}

export function formatTime(val: string | null | undefined): string | null {
  if (!val) return null;
  return val.slice(0, 5); // Return HH:mm
}

export function toTaskDto(row: TaskRow, trackedSeconds?: number): TaskDto {
  const dto: TaskDto = {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: priorityToString(row.priority),
    dueDate: formatDateOnly(row.due_date),
    dueTime: formatTime(row.due_time),
    plannedDate: formatDateOnly(row.planned_date),
    isFocus: row.is_focus,
    estimateMinutes: row.estimate_minutes,
    projectId: row.project_id,
    recurringTaskId: row.recurring_task_id,
    occurrenceDate: formatDateOnly(row.occurrence_date),
    completedAt: formatIso(row.completed_at),
    createdAt: formatIso(row.created_at)!,
    updatedAt: formatIso(row.updated_at)!,
    version: row.version
  };

  if (trackedSeconds !== undefined) {
    dto.trackedSeconds = trackedSeconds;
  }

  return dto;
}
