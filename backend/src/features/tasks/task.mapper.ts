/**
 * Task record to client response (spec section 35).
 *
 * `isOverdue` and `isTimerRunning` are DERIVED here rather than stored. A stored
 * boolean would be wrong the moment a due date passes without a write, and would
 * need a background job purely to keep it honest.
 */
import type {
  TaskResponse,
  TaskWithTimer,
  TimerSessionRecord,
  TimerSessionResponse,
} from './task.types';

export function toTaskResponse(record: TaskWithTimer, now: Date = new Date()): TaskResponse {
  const isOverdue =
    record.dueDate !== null && record.status !== 'done' && record.dueDate.getTime() < now.getTime();

  return {
    id: record.id,
    projectId: record.projectId,
    title: record.title,
    description: record.description,
    dueDate: record.dueDate?.toISOString() ?? null,
    priority: record.priority,
    status: record.status,
    isRecurring: record.isRecurring,
    recurrenceRule: record.recurrenceRule,
    hasTimer: record.hasTimer,
    isOverdue,
    totalTrackedSeconds: record.totalTrackedSeconds,
    isTimerRunning: record.runningSessionId !== null,
    timerStartedAt: record.runningSessionStartedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toTimerSessionResponse(record: TimerSessionRecord): TimerSessionResponse {
  return {
    id: record.id,
    startTime: record.startTime.toISOString(),
    endTime: record.endTime?.toISOString() ?? null,
    // Null rather than a live-ticking number: a duration computed at serialization
    // time would be stale the instant it reached the client.
    durationSeconds:
      record.endTime === null
        ? null
        : Math.floor((record.endTime.getTime() - record.startTime.getTime()) / 1000),
  };
}
