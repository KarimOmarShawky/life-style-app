/**
 * src/features/projects/projects.repository.pg.ts
 *
 * Implements Section 4.3 & 6.4: PostgreSQL Projects Repository with Kysely.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type {
  ProjectsRepository,
  CreateProjectDbInput,
  UpdateProjectDbInput
} from './projects.repository.js';
import type { ProjectRow, ProjectStatus, ProjectTaskCounts } from './projects.types.js';

export class PgProjectsRepository implements ProjectsRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async create(input: CreateProjectDbInput): Promise<ProjectRow> {
    const result = await this.db
      .insertInto('projects')
      .values({
        user_id: input.userId,
        name: input.name,
        description: input.description ?? null,
        status: input.status ?? 'active',
        color: input.color ?? null,
        goal_id: input.goalId ?? null,
        due_date: input.dueDate ?? null
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return result as unknown as ProjectRow;
  }

  async findById(userId: string, id: string): Promise<ProjectRow | null> {
    const result = await this.db
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return (result as unknown as ProjectRow) ?? null;
  }

  async findActiveById(userId: string, id: string): Promise<ProjectRow | null> {
    const result = await this.db
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return (result as unknown as ProjectRow) ?? null;
  }

  async update(
    userId: string,
    id: string,
    input: UpdateProjectDbInput,
    expectedVersion?: number
  ): Promise<ProjectRow | null> {
    let query = this.db
      .updateTable('projects')
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.goalId !== undefined ? { goal_id: input.goalId } : {}),
        ...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
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
    return (result as unknown as ProjectRow) ?? null;
  }

  async softDelete(userId: string, id: string, cascade: boolean): Promise<boolean> {
    return await this.db.transaction().execute(async (trx) => {
      // 1. Verify project exists and is active
      const project = await trx
        .selectFrom('projects')
        .select(['id'])
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      if (!project) return false;

      // 2. Cascade soft-delete vs detach open/done tasks (AC-PROJ-01)
      if (cascade) {
        await trx
          .updateTable('tasks')
          .set({
            deleted_at: new Date(),
            updated_at: new Date()
          })
          .where('project_id', '=', id)
          .where('user_id', '=', userId)
          .where('deleted_at', 'is', null)
          .execute();
      } else {
        await trx
          .updateTable('tasks')
          .set({
            project_id: null,
            updated_at: new Date()
          })
          .where('project_id', '=', id)
          .where('user_id', '=', userId)
          .where('deleted_at', 'is', null)
          .execute();
      }

      // 3. Soft delete project
      const result = await trx
        .updateTable('projects')
        .set({
          deleted_at: new Date(),
          updated_at: new Date()
        })
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      return Number(result.numUpdatedRows ?? 0) > 0;
    });
  }

  async restore(userId: string, id: string, maxAgeDays = 30): Promise<ProjectRow | null> {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    const result = await this.db
      .updateTable('projects')
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

    return (result as unknown as ProjectRow) ?? null;
  }

  async list(
    userId: string,
    status?: ProjectStatus[],
    limit = 25,
    cursor?: string
  ): Promise<{ projects: ProjectRow[]; nextCursor: string | null }> {
    let query = this.db
      .selectFrom('projects')
      .selectAll()
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);

    if (status && status.length > 0) {
      query = query.where('status', 'in', status);
    }

    query = query.orderBy('created_at', 'desc').orderBy('id', 'desc');

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8');
        const { id, createdAt } = JSON.parse(decoded);
        if (id && createdAt) {
          const cursorDate = new Date(createdAt);
          query = query.where((eb) =>
            eb.or([
              eb('created_at', '<', cursorDate),
              eb.and([eb('created_at', '=', cursorDate), eb('id', '<', id)])
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
        createdAt: (lastItem.created_at as Date).toISOString()
      };
      nextCursor = Buffer.from(JSON.stringify(payload)).toString('base64');
    }

    return {
      projects: items as unknown as ProjectRow[],
      nextCursor
    };
  }

  async getTaskCounts(
    userId: string,
    projectIds: string[]
  ): Promise<Map<string, ProjectTaskCounts>> {
    const countsMap = new Map<string, ProjectTaskCounts>();
    if (projectIds.length === 0) return countsMap;

    for (const pid of projectIds) {
      countsMap.set(pid, { open: 0, done: 0 });
    }

    const rows = await sql<{ project_id: string; open_count: string; done_count: string }>`
      SELECT
        project_id,
        COUNT(CASE WHEN status IN ('todo', 'in_progress') THEN 1 END) AS open_count,
        COUNT(CASE WHEN status = 'done' THEN 1 END) AS done_count
      FROM tasks
      WHERE user_id = ${userId}
        AND project_id IN (${sql.join(projectIds)})
        AND deleted_at IS NULL
      GROUP BY project_id
    `.execute(this.db);

    for (const row of rows.rows) {
      countsMap.set(row.project_id, {
        open: parseInt(row.open_count, 10) || 0,
        done: parseInt(row.done_count, 10) || 0
      });
    }

    return countsMap;
  }
}
