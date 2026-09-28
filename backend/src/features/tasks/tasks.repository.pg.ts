/**
 * src/features/tasks/tasks.repository.pg.ts
 *
 * Implements Section 4.3 & 6.4: PostgreSQL Tasks Repository with Kysely.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type { TasksRepository, CreateTaskDbInput, UpdateTaskDbInput } from './tasks.repository.js';
import type { TaskRow, ListTasksFilter } from './tasks.types.js';

export class PgTasksRepository implements TasksRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async create(input: CreateTaskDbInput): Promise<TaskRow> {
    const result = await this.db
      .insertInto('tasks')
      .values({
        user_id: input.userId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'todo',
        priority: input.priority ?? 0,
        due_date: input.dueDate ?? null,
        due_time: input.dueTime ?? null,
        planned_date: input.plannedDate ?? null,
        is_focus: input.isFocus ?? false,
        estimate_minutes: input.estimateMinutes ?? null,
        project_id: input.projectId ?? null,
        recurring_task_id: input.recurringTaskId ?? null,
        occurrence_date: input.occurrenceDate ?? null,
        is_customized: input.isCustomized ?? false,
        completed_at: input.completedAt ?? null
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return result as unknown as TaskRow;
  }

  async findById(userId: string, id: string): Promise<TaskRow | null> {
    const result = await this.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return (result as unknown as TaskRow) ?? null;
  }

  async findActiveById(userId: string, id: string): Promise<TaskRow | null> {
    const result = await this.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return (result as unknown as TaskRow) ?? null;
  }

  async update(
    userId: string,
    id: string,
    input: UpdateTaskDbInput,
    expectedVersion?: number
  ): Promise<TaskRow | null> {
    let query = this.db
      .updateTable('tasks')
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
        ...(input.dueTime !== undefined ? { due_time: input.dueTime } : {}),
        ...(input.plannedDate !== undefined ? { planned_date: input.plannedDate } : {}),
        ...(input.isFocus !== undefined ? { is_focus: input.isFocus } : {}),
        ...(input.estimateMinutes !== undefined ? { estimate_minutes: input.estimateMinutes } : {}),
        ...(input.projectId !== undefined ? { project_id: input.projectId } : {}),
        ...(input.isCustomized !== undefined ? { is_customized: input.isCustomized } : {}),
        ...(input.completedAt !== undefined ? { completed_at: input.completedAt } : {}),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);

    if (expectedVersion !== undefined) {
      query = query.where('version', '=', expectedVersion);
    }

    const result = await query.returningAll().executeTakeFirst();
    return (result as unknown as TaskRow) ?? null;
  }

  async softDelete(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .updateTable('tasks')
      .set({
        deleted_at: new Date(),
        updated_at: new Date()
      })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows ?? 0) > 0) {
      await this.cancelRemindersForTask(userId, id);
      return true;
    }
    return false;
  }

  async restore(userId: string, id: string, maxAgeDays = 30): Promise<TaskRow | null> {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    const result = await this.db
      .updateTable('tasks')
      .set({
        deleted_at: null,
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is not', null)
      .where('deleted_at', '>=', cutoff)
      .returningAll()
      .executeTakeFirst();

    return (result as unknown as TaskRow) ?? null;
  }

  async list(
    userId: string,
    filter: ListTasksFilter,
    userToday: string
  ): Promise<{ tasks: TaskRow[]; nextCursor: string | null }> {
    const limit = filter.limit ?? 25;
    let query = this.db
      .selectFrom('tasks')
      .selectAll()
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);

    if (filter.status && filter.status.length > 0) {
      query = query.where('status', 'in', filter.status);
    }

    if (filter.priority && filter.priority.length > 0) {
      query = query.where('priority', 'in', filter.priority);
    }

    if (filter.projectId !== undefined) {
      if (filter.projectId === 'none') {
        query = query.where('project_id', 'is', null);
      } else {
        query = query.where('project_id', '=', filter.projectId);
      }
    }

    if (filter.dueFrom) {
      query = query.where('due_date', '>=', filter.dueFrom);
    }
    if (filter.dueTo) {
      query = query.where('due_date', '<=', filter.dueTo);
    }

    if (filter.plannedDate) {
      query = query.where('planned_date', '=', filter.plannedDate);
    }

    if (filter.isFocus !== undefined) {
      query = query.where('is_focus', '=', filter.isFocus);
    }

    if (filter.overdue) {
      // AC-TASK-03: due_date < user_today AND status NOT IN ('done', 'cancelled')
      query = query
        .where('due_date', '<', userToday)
        .where('status', 'not in', ['done', 'cancelled']);
    }

    if (filter.completedFrom) {
      query = query.where('completed_at', '>=', new Date(filter.completedFrom));
    }
    if (filter.completedTo) {
      query = query.where('completed_at', '<=', new Date(filter.completedTo));
    }

    // Sort order
    const orderDirection = filter.order === 'desc' ? 'desc' : 'asc';
    switch (filter.sort) {
      case 'dueDate':
        query = query.orderBy('due_date', orderDirection).orderBy('id', orderDirection);
        break;
      case 'priority':
        query = query.orderBy('priority', orderDirection).orderBy('id', orderDirection);
        break;
      case 'updatedAt':
        query = query.orderBy('updated_at', orderDirection).orderBy('id', orderDirection);
        break;
      case 'createdAt':
      default:
        query = query.orderBy('created_at', orderDirection).orderBy('id', orderDirection);
        break;
    }

    // Cursor pagination (keyset pagination base64)
    if (filter.cursor) {
      try {
        const decoded = Buffer.from(filter.cursor, 'base64').toString('utf8');
        const { id, createdAt } = JSON.parse(decoded);
        if (id) {
          if (filter.sort === 'dueDate') {
            if (orderDirection === 'desc') {
              query = query.where('id', '<', id);
            } else {
              query = query.where('id', '>', id);
            }
          } else {
            const cursorDate = new Date(createdAt);
            if (orderDirection === 'desc') {
              query = query.where((eb) =>
                eb.or([
                  eb('created_at', '<', cursorDate),
                  eb.and([eb('created_at', '=', cursorDate), eb('id', '<', id)])
                ])
              );
            } else {
              query = query.where((eb) =>
                eb.or([
                  eb('created_at', '>', cursorDate),
                  eb.and([eb('created_at', '=', cursorDate), eb('id', '>', id)])
                ])
              );
            }
          }
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
        createdAt: (lastItem.created_at as Date).toISOString()
      };
      nextCursor = Buffer.from(JSON.stringify(payload)).toString('base64');
    }

    return {
      tasks: items as unknown as TaskRow[],
      nextCursor
    };
  }

  async unfocusAllForDate(
    userId: string,
    plannedDate: string,
    excludeTaskId?: string
  ): Promise<void> {
    let query = this.db
      .updateTable('tasks')
      .set({
        is_focus: false,
        updated_at: new Date()
      })
      .where('user_id', '=', userId)
      .where('planned_date', '=', plannedDate)
      .where('is_focus', '=', true)
      .where('deleted_at', 'is', null);

    if (excludeTaskId) {
      query = query.where('id', '!=', excludeTaskId);
    }

    await query.execute();
  }

  async cancelRemindersForTask(userId: string, taskId: string): Promise<void> {
    await this.db
      .updateTable('reminders')
      .set({
        status: 'cancelled',
        updated_at: new Date()
      })
      .where('user_id', '=', userId)
      .where('task_id', '=', taskId)
      .where('status', '=', 'pending')
      .execute();
  }

  async getTrackedSecondsForTask(userId: string, taskId: string): Promise<number> {
    // 1. Completed sessions
    const completedResult = await sql<{ total_seconds: string | null }>`
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at))::int), 0) AS total_seconds
      FROM timer_sessions
      WHERE user_id = ${userId}
        AND task_id = ${taskId}
        AND ended_at IS NOT NULL
    `.execute(this.db);

    const completedSeconds = parseInt(completedResult.rows[0]?.total_seconds ?? '0', 10) || 0;

    // 2. Running session if any
    const running = await this.db
      .selectFrom('timer_sessions')
      .select(['started_at'])
      .where('user_id', '=', userId)
      .where('task_id', '=', taskId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();

    let runningSeconds = 0;
    if (running && running.started_at) {
      const started = new Date(running.started_at).getTime();
      runningSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    }

    return completedSeconds + runningSeconds;
  }

  async batchInsert(tasks: CreateTaskDbInput[]): Promise<TaskRow[]> {
    if (tasks.length === 0) return [];

    const values = tasks.map((t) => ({
      user_id: t.userId,
      title: t.title,
      description: t.description ?? null,
      status: t.status ?? 'todo',
      priority: t.priority ?? 0,
      due_date: t.dueDate ?? null,
      due_time: t.dueTime ?? null,
      planned_date: t.plannedDate ?? null,
      is_focus: t.isFocus ?? false,
      estimate_minutes: t.estimateMinutes ?? null,
      project_id: t.projectId ?? null,
      recurring_task_id: t.recurringTaskId ?? null,
      occurrence_date: t.occurrenceDate ?? null,
      is_customized: t.isCustomized ?? false,
      completed_at: t.completedAt ?? null
    }));

    const results = await this.db.insertInto('tasks').values(values).returningAll().execute();
    return results as unknown as TaskRow[];
  }

  async updateFutureInstances(
    recurringTaskId: string,
    userId: string,
    fromDate: string,
    updates: {
      title?: string | undefined;
      description?: string | null | undefined;
      priority?: number | undefined;
      estimateMinutes?: number | null | undefined;
      dueTime?: string | null | undefined;
      projectId?: string | null | undefined;
    }
  ): Promise<number> {
    const result = await this.db
      .updateTable('tasks')
      .set({
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.description !== undefined ? { description: updates.description } : {}),
        ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
        ...(updates.estimateMinutes !== undefined
          ? { estimate_minutes: updates.estimateMinutes }
          : {}),
        ...(updates.dueTime !== undefined ? { due_time: updates.dueTime } : {}),
        ...(updates.projectId !== undefined ? { project_id: updates.projectId } : {}),
        updated_at: new Date()
      })
      .where('recurring_task_id', '=', recurringTaskId)
      .where('user_id', '=', userId)
      .where('is_customized', '=', false)
      .where('status', 'in', ['todo', 'in_progress'])
      .where('occurrence_date', '>', fromDate)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0);
  }
}
