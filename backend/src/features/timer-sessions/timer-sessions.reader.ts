/**
 * src/features/timer-sessions/timer-sessions.reader.ts
 *
 * Read-only cross-feature interface for the focus-timer domain
 * (feature-architecture rule 2).
 */

import { type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';

export interface ActiveTimerItem {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  startedAt: string;
  mode: string;
  plannedSeconds: number | null;
}

export interface TimerReader {
  getActive(userId: string): Promise<ActiveTimerItem | null>;
}

export class PgTimerReader implements TimerReader {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async getActive(userId: string): Promise<ActiveTimerItem | null> {
    const row = await this.db
      .selectFrom('timer_sessions')
      .leftJoin('tasks', 'tasks.id', 'timer_sessions.task_id')
      .select([
        'timer_sessions.id as id',
        'timer_sessions.task_id as task_id',
        'tasks.title as task_title',
        'timer_sessions.started_at as started_at',
        'timer_sessions.mode as mode',
        'timer_sessions.planned_seconds as planned_seconds'
      ])
      .where('timer_sessions.user_id', '=', userId)
      .where('timer_sessions.ended_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      taskId: row.task_id,
      taskTitle: row.task_title ?? null,
      startedAt: row.started_at.toISOString(),
      mode: row.mode,
      plannedSeconds: row.planned_seconds
    };
  }
}
