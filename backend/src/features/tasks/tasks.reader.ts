/**
 * src/features/tasks/tasks.reader.ts
 *
 * Read-only cross-feature interface for the tasks domain (feature-architecture
 * rule 2). Query features (days/dashboard/search) depend on this contract and
 * never touch the tasks tables directly.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import { formatDateOnly } from '../../core/time/date-utils.js';

export interface TaskReaderItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  dueDate: string | null;
  dueTime: string | null;
  plannedDate: string | null;
  isFocus: boolean;
  estimateMinutes: number | null;
}

export interface TaskReader {
  listForDate(userId: string, date: string): Promise<TaskReaderItem[]>;
  search(userId: string, q: string, limit: number): Promise<TaskReaderItem[]>;
  countByStatusSince(
    userId: string,
    since: string
  ): Promise<Array<{ status: string; count: number }>>;
  countOverdue(userId: string, beforeDate: string): Promise<number>;
}

const SELECT_TASK = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'due_date',
  'due_time',
  'planned_date',
  'is_focus',
  'estimate_minutes'
] as const;

function toTaskItem(row: Record<string, unknown>): TaskReaderItem {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    status: row.status as string,
    priority: row.priority as number,
    dueDate: formatDateOnly(row.due_date as Date | string | null),
    dueTime: (row.due_time as string | null) ?? null,
    plannedDate: formatDateOnly(row.planned_date as Date | string | null),
    isFocus: Boolean(row.is_focus),
    estimateMinutes: (row.estimate_minutes as number | null) ?? null
  };
}

export class PgTaskReader implements TaskReader {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async listForDate(userId: string, date: string): Promise<TaskReaderItem[]> {
    const rows = await this.db
      .selectFrom('tasks')
      .select([...SELECT_TASK])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where((eb) =>
        eb.or([eb('due_date', '=', date as never), eb('planned_date', '=', date as never)])
      )
      .orderBy('priority', 'desc')
      .orderBy('due_time', 'asc')
      .execute();
    return rows.map((row) => toTaskItem(row as unknown as Record<string, unknown>));
  }

  public async search(userId: string, q: string, limit: number): Promise<TaskReaderItem[]> {
    const pattern = `%${q}%`;
    const rows = await this.db
      .selectFrom('tasks')
      .select([...SELECT_TASK])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('title', 'ilike', pattern),
          eb(sql`search_vector`, '@@', sql`plainto_tsquery('simple', ${q})`)
        ])
      )
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((row) => toTaskItem(row as unknown as Record<string, unknown>));
  }

  public async countByStatusSince(
    userId: string,
    since: string
  ): Promise<Array<{ status: string; count: number }>> {
    const rows = await this.db
      .selectFrom('tasks')
      .select(['status', (eb) => eb.fn.countAll<number>().as('count')])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where('created_at', '>=', since as never)
      .groupBy('status')
      .execute();
    return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
  }

  public async countOverdue(userId: string, beforeDate: string): Promise<number> {
    const row = await this.db
      .selectFrom('tasks')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where('due_date', '<', beforeDate as never)
      .where('status', 'not in', ['done', 'cancelled'])
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }
}
