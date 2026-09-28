/**
 * src/features/timer-sessions/timer-sessions.repository.ts
 *
 * Implements Section 4.3 & 6.4: Timer Sessions Repository Interface.
 */

import type {
  TimerSessionRow,
  TimerMode,
  TimerEndReason,
  ListTimerSessionsFilter
} from './timer-sessions.types.js';

export interface CreateTimerSessionDbInput {
  userId: string;
  taskId: string;
  startedAt: Date;
  mode: TimerMode;
  plannedSeconds?: number | null;
}

export interface TimerSessionsRepository {
  findActiveSession(userId: string): Promise<TimerSessionRow | null>;
  create(input: CreateTimerSessionDbInput): Promise<TimerSessionRow>;
  findById(userId: string, id: string): Promise<TimerSessionRow | null>;
  stop(
    userId: string,
    id: string,
    endedAt: Date,
    endReason: TimerEndReason
  ): Promise<TimerSessionRow | null>;
  autoCloseOlderThan(userId: string, cutoff: Date): Promise<TimerSessionRow | null>;
  list(
    userId: string,
    filter: ListTimerSessionsFilter
  ): Promise<{ sessions: TimerSessionRow[]; nextCursor: string | null }>;
  delete(userId: string, id: string): Promise<boolean>;
}
