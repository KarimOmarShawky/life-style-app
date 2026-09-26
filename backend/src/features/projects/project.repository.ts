/**
 * Project persistence.
 *
 * OWNERSHIP IS IN EVERY QUERY. Each statement carries `user_id = $n`, so a
 * request for another user's project returns no row rather than their data.
 * This is deliberate (decision DD-008): a middleware check can be forgotten when
 * a method is added, a WHERE clause cannot.
 */
import { query } from '@/infrastructure/database/postgres/pool';
import type { Cursor } from '@/core/utils/pagination';

import type { CreateProjectInput, ProjectWithStats, UpdateProjectInput } from './project.types';

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  task_count: string;
  open_task_count: string;
}

function toRecord(row: ProjectRow): ProjectWithStats {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    // COUNT returns bigint, which the driver hands back as a string to avoid
    // precision loss. These counts are small, so narrowing is safe here.
    taskCount: Number(row.task_count),
    openTaskCount: Number(row.open_task_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Counts are correlated subqueries rather than a GROUP BY join, so a project
 * with no tasks still returns a row with zero rather than disappearing.
 */
const SELECT_WITH_STATS = `
  SELECT p.id, p.user_id, p.name, p.description, p.created_at, p.updated_at,
         (SELECT count(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
         (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status <> 'done') AS open_task_count
    FROM projects p`;

export async function insertProject(
  userId: string,
  input: CreateProjectInput,
): Promise<ProjectWithStats> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO projects (user_id, name, description)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, input.name, input.description ?? null],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) {
    throw new Error('INSERT ... RETURNING produced no row');
  }

  const created = await findProjectById(userId, id);
  if (!created) {
    throw new Error('project vanished immediately after insert');
  }
  return created;
}

export async function findProjectById(
  userId: string,
  projectId: string,
): Promise<ProjectWithStats | undefined> {
  const result = await query<ProjectRow>(
    `${SELECT_WITH_STATS} WHERE p.id = $1 AND p.user_id = $2`,
    [projectId, userId],
  );

  const row = result.rows[0];
  return row ? toRecord(row) : undefined;
}

/**
 * Lists a user's projects, newest first.
 *
 * Fetches `limit + 1` so the caller can tell whether another page exists without
 * a second COUNT query. The keyset predicate uses row-value comparison,
 * `(created_at, id) < ($cursor...)`, which PostgreSQL can satisfy directly from
 * a composite index instead of evaluating an OR chain.
 */
export async function listProjects(
  userId: string,
  limit: number,
  cursor: Cursor | undefined,
): Promise<ProjectWithStats[]> {
  if (cursor) {
    const result = await query<ProjectRow>(
      `${SELECT_WITH_STATS}
        WHERE p.user_id = $1 AND (p.created_at, p.id) < ($2, $3)
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $4`,
      [userId, cursor.createdAt, cursor.id, limit + 1],
    );
    return result.rows.map(toRecord);
  }

  const result = await query<ProjectRow>(
    `${SELECT_WITH_STATS}
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $2`,
    [userId, limit + 1],
  );
  return result.rows.map(toRecord);
}

/**
 * Applies a partial update.
 *
 * COALESCE with a sentinel is avoided deliberately: `description` can legitimately
 * be set to NULL, so COALESCE would make clearing it impossible. Instead each
 * column is updated only when its parameter flag says it was supplied.
 */
export async function updateProject(
  userId: string,
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectWithStats | undefined> {
  const nameSupplied = input.name !== undefined;
  const descriptionSupplied = input.description !== undefined;

  const result = await query<{ id: string }>(
    `UPDATE projects
        SET name        = CASE WHEN $3::boolean THEN $4::text ELSE name END,
            description = CASE WHEN $5::boolean THEN $6::text ELSE description END
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [
      projectId,
      userId,
      nameSupplied,
      input.name ?? null,
      descriptionSupplied,
      input.description ?? null,
    ],
  );

  if (result.rowCount === 0) {
    return undefined;
  }

  return findProjectById(userId, projectId);
}

/**
 * Deletes a project.
 *
 * Tasks are NOT deleted: the foreign key is `ON DELETE SET NULL`, so they become
 * ungrouped rather than disappearing. Losing a week of tasks because a project
 * was tidied away would be the more damaging default.
 */
export async function deleteProject(userId: string, projectId: string): Promise<boolean> {
  const result = await query(`DELETE FROM projects WHERE id = $1 AND user_id = $2`, [
    projectId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
