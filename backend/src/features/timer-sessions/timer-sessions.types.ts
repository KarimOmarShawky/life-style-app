/**
 * src/features/timer-sessions/timer-sessions.types.ts
 *
 * Implements Section 6.4 & 14.7: Timer Sessions Domain Types.
 */

export type TimerMode = 'stopwatch' | 'countdown';
export type TimerEndReason = 'stopped' | 'completed' | 'auto_closed';

export interface TimerSessionRow {
  id: string;
  user_id: string;
  task_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  mode: TimerMode;
  planned_seconds: number | null;
  end_reason: TimerEndReason | null;
  created_at: Date;
  updated_at: Date;
}

export interface TimerSessionDto {
  id: string;
  taskId: string | null;
  startedAt: string;
  endedAt: string | null;
  mode: TimerMode;
  plannedSeconds: number | null;
  durationSeconds: number;
  endReason: TimerEndReason | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListTimerSessionsFilter {
  taskId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}
