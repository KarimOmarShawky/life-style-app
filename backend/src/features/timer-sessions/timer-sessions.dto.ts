/**
 * src/features/timer-sessions/timer-sessions.dto.ts
 *
 * Implements Section 14.7 & AC-TMR-02: Timer Sessions DTO Serialization.
 */

import type { TimerSessionRow, TimerSessionDto } from './timer-sessions.types.js';

function formatIso(val: Date | string | null): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString();
  }
  return new Date(val).toISOString();
}

export function toTimerSessionDto(row: TimerSessionRow, now: Date = new Date()): TimerSessionDto {
  const startedAt = row.started_at instanceof Date ? row.started_at : new Date(row.started_at);
  const endedAt = row.ended_at
    ? row.ended_at instanceof Date
      ? row.ended_at
      : new Date(row.ended_at)
    : null;

  let durationSeconds: number;
  if (endedAt) {
    durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
  } else {
    durationSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
  }

  return {
    id: row.id,
    taskId: row.task_id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt ? endedAt.toISOString() : null,
    mode: row.mode,
    plannedSeconds: row.planned_seconds,
    durationSeconds,
    endReason: row.end_reason,
    createdAt: formatIso(row.created_at)!,
    updatedAt: formatIso(row.updated_at)!
  };
}
