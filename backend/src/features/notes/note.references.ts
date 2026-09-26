/**
 * The PostgreSQL half of the cross-database boundary (spec section 8).
 *
 * A note lives in MongoDB but may point at a project or a task, which live in
 * PostgreSQL. No foreign key can span that boundary, so everything a foreign key
 * would have done automatically is done explicitly here:
 *
 *   WRITE TIME  a link is accepted only if the target exists AND belongs to the
 *               same user. That single query is both the existence check and the
 *               ownership check, so a note cannot be attached to another user's
 *               task, and a caller cannot probe for valid ids.
 *
 *   READ TIME   links are resolved in bulk and an unresolved one is reported as
 *               null. A deleted task leaves a dangling id behind; returning it
 *               would hand the client an id that 404s.
 *
 *   LATER       `reconcileLinks` clears the dangling ids for good.
 *
 * These helpers duplicate a little of what the tasks feature does. That is the
 * price of vertical slices: one feature importing another's repository is how a
 * change to tasks silently breaks notes.
 */
import { query } from '@/infrastructure/database/postgres/pool';

/** Does this project exist and belong to this user? */
export async function projectBelongsToUser(userId: string, projectId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT true AS exists FROM projects WHERE id = $1 AND user_id = $2`,
    [projectId, userId],
  );
  return result.rowCount === 1;
}

/** Does this task exist and belong to this user? */
export async function taskBelongsToUser(userId: string, taskId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT true AS exists FROM tasks WHERE id = $1 AND user_id = $2`,
    [taskId, userId],
  );
  return result.rowCount === 1;
}

/**
 * Narrows a set of ids to those that exist and belong to the user.
 *
 * One query for a whole page rather than one per note: a 100-note page would
 * otherwise cost 200 round trips to resolve its links, which on a remote
 * database is the difference between a fast response and a slow one.
 */
async function existingIds(
  table: 'projects' | 'tasks',
  userId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) {
    return new Set();
  }

  // The table name is a literal from the union type above, never client input.
  // Ids are parameterized and cast to uuid[], so a malformed one is a clean
  // database error rather than a silent mismatch.
  const result = await query<{ id: string }>(
    `SELECT id FROM ${table} WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, [...ids]],
  );

  return new Set(result.rows.map((row) => row.id));
}

export function existingProjectIds(
  userId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  return existingIds('projects', userId, ids);
}

export function existingTaskIds(
  userId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  return existingIds('tasks', userId, ids);
}
