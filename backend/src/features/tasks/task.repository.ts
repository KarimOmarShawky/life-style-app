/**
 * Task and timer-session persistence.
 *
 * Every statement is parameterized and every statement filters on `user_id`.
 * The filter builder below assembles a WHERE clause dynamically, which is the
 * one place in this codebase where SQL text is constructed at runtime. Read the
 * note on `buildFilters` for why that is still injection-safe.
 */
import { query, withTransaction } from '@/infrastructure/database/postgres/pool';
import type { Cursor } from '@/core/utils/pagination';

import type {
  CreateTaskInput,
  TaskFilters,
  TaskPriority,
  TaskStatus,
  TaskWithTimer,
  TimerSessionRecord,
  UpdateTaskInput,
} from './task.types';

interface TaskRow {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  due_date: Date | null;
  priority: string;
  status: string;
  is_recurring: boolean;
  recurrence_rule: string | null;
  has_timer: boolean;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  total_tracked_seconds: string | null;
  running_session_id: string | null;
  running_session_started_at: Date | null;
}

function toRecord(row: TaskRow): TaskWithTimer {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    priority: row.priority as TaskPriority,
    status: row.status as TaskStatus,
    isRecurring: row.is_recurring,
    recurrenceRule: row.recurrence_rule,
    hasTimer: row.has_timer,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalTrackedSeconds: Math.floor(Number(row.total_tracked_seconds ?? 0)),
    runningSessionId: row.running_session_id,
    runningSessionStartedAt: row.running_session_started_at,
  };
}

/**
 * Timer aggregates are computed in SQL rather than by loading sessions into the
 * application. A task with a year of tracking has thousands of sessions; summing
 * them in Node would mean transferring all of them to produce one number.
 *
 * The completed-session sum deliberately EXCLUDES a running session, so the
 * total does not appear to tick upward on a page that is not refreshing.
 */
const SELECT_TASK = `
  SELECT t.id, t.user_id, t.project_id, t.title, t.description, t.due_date,
         t.priority, t.status, t.is_recurring, t.recurrence_rule, t.has_timer,
         t.completed_at, t.created_at, t.updated_at,
         (SELECT COALESCE(sum(extract(epoch FROM (ts.end_time - ts.start_time))), 0)
            FROM timer_sessions ts
           WHERE ts.task_id = t.id AND ts.end_time IS NOT NULL) AS total_tracked_seconds,
         (SELECT ts.id FROM timer_sessions ts
           WHERE ts.task_id = t.id AND ts.end_time IS NULL LIMIT 1) AS running_session_id,
         (SELECT ts.start_time FROM timer_sessions ts
           WHERE ts.task_id = t.id AND ts.end_time IS NULL LIMIT 1) AS running_session_started_at
    FROM tasks t`;

export async function insertTask(userId: string, input: CreateTaskInput): Promise<TaskWithTimer> {
  const status = input.status ?? 'todo';

  const inserted = await query<{ id: string }>(
    `INSERT INTO tasks (
       user_id, project_id, title, description, due_date, priority, status,
       is_recurring, recurrence_rule, has_timer, completed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             CASE WHEN $7 = 'done' THEN now() ELSE NULL END)
     RETURNING id`,
    [
      userId,
      input.projectId ?? null,
      input.title,
      input.description ?? null,
      input.dueDate ?? null,
      input.priority ?? 'medium',
      status,
      input.isRecurring ?? false,
      input.recurrenceRule ?? null,
      input.hasTimer ?? false,
    ],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) {
    throw new Error('INSERT ... RETURNING produced no row');
  }

  const created = await findTaskById(userId, id);
  if (!created) {
    throw new Error('task vanished immediately after insert');
  }
  return created;
}

export async function findTaskById(
  userId: string,
  taskId: string,
): Promise<TaskWithTimer | undefined> {
  const result = await query<TaskRow>(`${SELECT_TASK} WHERE t.id = $1 AND t.user_id = $2`, [
    taskId,
    userId,
  ]);

  const row = result.rows[0];
  return row ? toRecord(row) : undefined;
}

/**
 * Builds the dynamic WHERE fragment for list filters.
 *
 * INJECTION SAFETY. Every fragment appended here is a string LITERAL written in
 * this file. No caller-supplied text is ever concatenated: user values become
 * `$n` placeholders pushed onto the params array. The only thing that varies at
 * runtime is WHICH fixed fragments are included, driven by whether a filter is
 * present. An attacker can therefore influence the shape of the query but never
 * its text (spec section 14).
 */
function buildFilters(filters: TaskFilters, params: unknown[]): string {
  const clauses: string[] = [];

  if (filters.status !== undefined) {
    params.push(filters.status);
    clauses.push(`t.status = $${params.length}`);
  }

  if (filters.priority !== undefined) {
    params.push(filters.priority);
    clauses.push(`t.priority = $${params.length}`);
  }

  if (filters.projectId !== undefined) {
    params.push(filters.projectId);
    clauses.push(`t.project_id = $${params.length}`);
  }

  if (filters.dueBefore !== undefined) {
    params.push(filters.dueBefore);
    clauses.push(`t.due_date <= $${params.length}`);
  }

  if (filters.overdue === true) {
    // Overdue means past its due date AND not finished. A completed task is
    // never overdue, however late it was done.
    clauses.push(`t.due_date < now() AND t.status <> 'done'`);
  }

  if (filters.search !== undefined) {
    // ILIKE with the wildcards added as part of the PARAMETER, not the SQL.
    // A search for "100%" is matched literally rather than becoming a wildcard.
    params.push(`%${filters.search.replace(/[%_\\]/g, '\\$&')}%`);
    clauses.push(`t.title ILIKE $${params.length}`);
  }

  return clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '';
}

export async function listTasks(
  userId: string,
  limit: number,
  cursor: Cursor | undefined,
  filters: TaskFilters,
): Promise<TaskWithTimer[]> {
  const params: unknown[] = [userId];
  let sql = `${SELECT_TASK} WHERE t.user_id = $1`;

  sql += buildFilters(filters, params);

  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    sql += ` AND (t.created_at, t.id) < ($${params.length - 1}, $${params.length})`;
  }

  params.push(limit + 1);
  sql += ` ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length}`;

  const result = await query<TaskRow>(sql, params);
  return result.rows.map(toRecord);
}

/**
 * Applies a partial update.
 *
 * `completed_at` is derived, never supplied by the client: it is set when the
 * status becomes done and cleared when it moves away. The database enforces the
 * same rule with `tasks_completed_matches_status`, so an inconsistent pair
 * cannot be written even from elsewhere.
 */
export async function updateTask(
  userId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskWithTimer | undefined> {
  const result = await query<{ id: string }>(
    `UPDATE tasks
        SET title           = CASE WHEN $3::boolean  THEN $4::text        ELSE title END,
            description     = CASE WHEN $5::boolean  THEN $6::text        ELSE description END,
            project_id      = CASE WHEN $7::boolean  THEN $8::uuid        ELSE project_id END,
            due_date        = CASE WHEN $9::boolean  THEN $10::timestamptz ELSE due_date END,
            priority        = CASE WHEN $11::boolean THEN $12::text       ELSE priority END,
            status          = CASE WHEN $13::boolean THEN $14::text       ELSE status END,
            is_recurring    = CASE WHEN $15::boolean THEN $16::boolean    ELSE is_recurring END,
            recurrence_rule = CASE WHEN $17::boolean THEN $18::text       ELSE recurrence_rule END,
            has_timer       = CASE WHEN $19::boolean THEN $20::boolean    ELSE has_timer END,
            completed_at    = CASE
                                WHEN $13::boolean AND $14::text = 'done'
                                  THEN COALESCE(completed_at, now())
                                WHEN $13::boolean AND $14::text <> 'done'
                                  THEN NULL
                                ELSE completed_at
                              END
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [
      taskId,
      userId,
      input.title !== undefined,
      input.title ?? null,
      input.description !== undefined,
      input.description ?? null,
      input.projectId !== undefined,
      input.projectId ?? null,
      input.dueDate !== undefined,
      input.dueDate ?? null,
      input.priority !== undefined,
      input.priority ?? null,
      input.status !== undefined,
      input.status ?? null,
      input.isRecurring !== undefined,
      input.isRecurring ?? null,
      input.recurrenceRule !== undefined,
      input.recurrenceRule ?? null,
      input.hasTimer !== undefined,
      input.hasTimer ?? null,
    ],
  );

  if (result.rowCount === 0) {
    return undefined;
  }

  return findTaskById(userId, taskId);
}

export async function deleteTask(userId: string, taskId: string): Promise<boolean> {
  // Timer sessions are removed by ON DELETE CASCADE: a session has no meaning
  // without its task, unlike a task without its project.
  const result = await query(`DELETE FROM tasks WHERE id = $1 AND user_id = $2`, [taskId, userId]);
  return (result.rowCount ?? 0) > 0;
}

/** Confirms a project exists AND belongs to this user, in one query. */
export async function projectBelongsToUser(userId: string, projectId: string): Promise<boolean> {
  const result = await query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [
    projectId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

// --- Timer sessions -------------------------------------------------------

interface TimerRow {
  id: string;
  task_id: string;
  start_time: Date;
  end_time: Date | null;
  created_at: Date;
}

function toTimerRecord(row: TimerRow): TimerSessionRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    startTime: row.start_time,
    endTime: row.end_time,
    createdAt: row.created_at,
  };
}

/**
 * Starts a timer session.
 *
 * Ownership is enforced inside the INSERT itself: the SELECT supplying the
 * values returns no row unless the task belongs to this user, so an unauthorized
 * start inserts nothing rather than relying on a preceding check.
 *
 * Concurrency is handled by the partial unique index
 * `timer_sessions_one_running_per_task`, which permits only one row per task
 * with a null end time. A double tap on Start therefore produces a unique
 * violation, surfaced by the caller as a clean conflict, instead of two
 * overlapping sessions that corrupt the total.
 */
export async function startTimerSession(
  userId: string,
  taskId: string,
): Promise<TimerSessionRecord | undefined> {
  const result = await query<TimerRow>(
    `INSERT INTO timer_sessions (task_id, user_id, start_time)
     SELECT t.id, t.user_id, now()
       FROM tasks t
      WHERE t.id = $1 AND t.user_id = $2
     RETURNING id, task_id, start_time, end_time, created_at`,
    [taskId, userId],
  );

  const row = result.rows[0];
  return row ? toTimerRecord(row) : undefined;
}

/**
 * Stops the running session for a task.
 *
 * The `end_time IS NULL` predicate makes this idempotent under concurrency: a
 * second Stop matches no row and is reported as "no timer running" rather than
 * overwriting the first stop's timestamp.
 */
export async function stopTimerSession(
  userId: string,
  taskId: string,
): Promise<TimerSessionRecord | undefined> {
  const result = await query<TimerRow>(
    `UPDATE timer_sessions
        SET end_time = now()
      WHERE task_id = $1 AND user_id = $2 AND end_time IS NULL
      RETURNING id, task_id, start_time, end_time, created_at`,
    [taskId, userId],
  );

  const row = result.rows[0];
  return row ? toTimerRecord(row) : undefined;
}

export async function listTimerSessions(
  userId: string,
  taskId: string,
  limit: number,
): Promise<TimerSessionRecord[]> {
  const result = await query<TimerRow>(
    `SELECT id, task_id, start_time, end_time, created_at
       FROM timer_sessions
      WHERE task_id = $1 AND user_id = $2
      ORDER BY start_time DESC
      LIMIT $3`,
    [taskId, userId, limit],
  );

  return result.rows.map(toTimerRecord);
}

/**
 * Deletes a project and reassigns its tasks in one transaction.
 *
 * Not used by the default delete path, which relies on ON DELETE SET NULL. Kept
 * for the case where tasks should move to another project instead of becoming
 * ungrouped, and written as a transaction because a partial move would leave
 * tasks split across two projects.
 */
export async function reassignTasksAndDeleteProject(
  userId: string,
  projectId: string,
  newProjectId: string | null,
): Promise<boolean> {
  return withTransaction(async (tx) => {
    const owned = await tx.query(`SELECT 1 FROM projects WHERE id = $1 AND user_id = $2`, [
      projectId,
      userId,
    ]);
    if (owned.rowCount === 0) {
      return false;
    }

    await tx.query(`UPDATE tasks SET project_id = $3 WHERE project_id = $1 AND user_id = $2`, [
      projectId,
      userId,
      newProjectId,
    ]);

    await tx.query(`DELETE FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
    return true;
  });
}
