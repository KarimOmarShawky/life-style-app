/**
 * src/features/timer-sessions/timer-sessions.repository.pg.ts
 *
 * Implements Section 4.3 & 6.4: PostgreSQL Timer Sessions Repository with Kysely.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type {
  TimerSessionsRepository,
  CreateTimerSessionDbInput
} from './timer-sessions.repository.js';
import type {
  TimerSessionRow,
  TimerEndReason,
  ListTimerSessionsFilter
} from './timer-sessions.types.js';

export class PgTimerSessionsRepository implements TimerSessionsRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findActiveSession(userId: string): Promise<TimerSessionRow | null> {
    const result = await this.db
      .selectFrom('timer_sessions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();

    return (result as unknown as TimerSessionRow) ?? null;
  }

  async create(input: CreateTimerSessionDbInput): Promise<TimerSessionRow> {
    const result = await this.db
      .insertInto('timer_sessions')
      .values({
        user_id: input.userId,
        task_id: input.taskId,
        started_at: input.startedAt,
        ended_at: null,
        mode: input.mode,
        planned_seconds: input.plannedSeconds ?? null,
        end_reason: null
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return result as unknown as TimerSessionRow;
  }

  async findById(userId: string, id: string): Promise<TimerSessionRow | null> {
    const result = await this.db
      .selectFrom('timer_sessions')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return (result as unknown as TimerSessionRow) ?? null;
  }

  async stop(
    userId: string,
    id: string,
    endedAt: Date,
    endReason: TimerEndReason
  ): Promise<TimerSessionRow | null> {
    const result = await this.db
      .updateTable('timer_sessions')
      .set({
        ended_at: endedAt,
        end_reason: endReason,
        updated_at: new Date()
      })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('ended_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    return (result as unknown as TimerSessionRow) ?? null;
  }

  async autoCloseOlderThan(userId: string, cutoff: Date): Promise<TimerSessionRow | null> {
    const result = await sql<TimerSessionRow>`
      UPDATE timer_sessions
      SET ended_at = started_at + INTERVAL '12 hours',
          end_reason = 'auto_closed',
          updated_at = NOW()
      WHERE user_id = ${userId}
        AND ended_at IS NULL
        AND started_at <= ${cutoff}
      RETURNING *
    `.execute(this.db);

    return result.rows[0] ?? null;
  }

  async list(
    userId: string,
    filter: ListTimerSessionsFilter
  ): Promise<{ sessions: TimerSessionRow[]; nextCursor: string | null }> {
    const limit = filter.limit ?? 25;
    let query = this.db.selectFrom('timer_sessions').selectAll().where('user_id', '=', userId);

    if (filter.taskId) {
      query = query.where('task_id', '=', filter.taskId);
    }

    if (filter.from) {
      query = query.where('started_at', '>=', new Date(filter.from));
    }

    if (filter.to) {
      query = query.where('started_at', '<=', new Date(filter.to));
    }

    query = query.orderBy('started_at', 'desc').orderBy('id', 'desc');

    if (filter.cursor) {
      try {
        const decoded = Buffer.from(filter.cursor, 'base64').toString('utf8');
        const { id, startedAt } = JSON.parse(decoded);
        if (id && startedAt) {
          const cursorDate = new Date(startedAt);
          query = query.where((eb) =>
            eb.or([
              eb('started_at', '<', cursorDate),
              eb.and([eb('started_at', '=', cursorDate), eb('id', '<', id)])
            ])
          );
        }
      } catch {
        // ignore invalid cursor
      }
    }

    const rows = await query.limit(limit + 1).execute();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    const lastItem = items.length > 0 ? items[items.length - 1] : undefined;
    if (hasMore && lastItem) {
      const payload = {
        id: lastItem.id,
        startedAt: (lastItem.started_at as Date).toISOString()
      };
      nextCursor = Buffer.from(JSON.stringify(payload)).toString('base64');
    }

    return {
      sessions: items as unknown as TimerSessionRow[],
      nextCursor
    };
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('timer_sessions')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0) > 0;
  }
}
