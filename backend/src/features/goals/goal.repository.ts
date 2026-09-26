/**
 * Goal and milestone persistence.
 *
 * THE DERIVED COMPLETION RULE. A milestone backed by a task is done when that
 * task is done. The `is_done` column is only consulted for milestones with no
 * task. Expressed once, here, as a SQL expression reused by every read:
 *
 *   CASE WHEN m.task_id IS NOT NULL THEN t.status = 'done' ELSE m.is_done END
 *
 * The alternative is to keep `is_done` authoritative and update it whenever the
 * task changes, which means every task write path has to remember to do so. The
 * first one that forgets leaves a goal reporting progress that contradicts the
 * task list, and nothing detects it. Deriving cannot drift.
 *
 * Ownership is in the WHERE clause of every statement (DD-008).
 */
import { formatCalendarDate } from '@/core/utils/calendar-date';
import { query, withTransaction } from '@/infrastructure/database/postgres/pool';
import type { Cursor } from '@/core/utils/pagination';

import type {
  CreateGoalInput,
  CreateMilestoneInput,
  GoalStatus,
  GoalWithProgress,
  MilestoneRecord,
  UpdateGoalInput,
  UpdateMilestoneInput,
} from './goal.types';

/** The single definition of "this milestone is finished". */
const MILESTONE_DONE = `CASE WHEN m.task_id IS NOT NULL THEN t.status = 'done' ELSE m.is_done END`;

interface GoalRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  target_date: Date | null;
  status: GoalStatus;
  created_at: Date;
  updated_at: Date;
  milestone_count: string;
  done_milestone_count: string;
}

interface MilestoneRow {
  id: string;
  goal_id: string;
  task_id: string | null;
  title: string;
  is_done: boolean;
  position: number;
  created_at: Date;
  updated_at: Date;
}

function toGoalRecord(row: GoalRow): GoalWithProgress {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    targetDate: row.target_date ? formatCalendarDate(row.target_date) : null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    milestoneCount: Number(row.milestone_count),
    doneMilestoneCount: Number(row.done_milestone_count),
  };
}

function toMilestoneRecord(row: MilestoneRow): MilestoneRecord {
  return {
    id: row.id,
    goalId: row.goal_id,
    taskId: row.task_id,
    title: row.title,
    isDone: row.is_done,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Counts are correlated subqueries rather than a GROUP BY join, so a goal with
 * no milestones still returns a row with zero rather than disappearing.
 */
const SELECT_WITH_PROGRESS = `
  SELECT g.id, g.user_id, g.title, g.description, g.target_date, g.status,
         g.created_at, g.updated_at,
         (SELECT count(*) FROM milestones m WHERE m.goal_id = g.id) AS milestone_count,
         (SELECT count(*)
            FROM milestones m
            LEFT JOIN tasks t ON t.id = m.task_id
           WHERE m.goal_id = g.id AND ${MILESTONE_DONE}) AS done_milestone_count
    FROM goals g`;

export async function insertGoal(
  userId: string,
  input: CreateGoalInput,
): Promise<GoalWithProgress> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO goals (user_id, title, description, target_date, status)
     VALUES ($1, $2, $3, $4::date, coalesce($5, 'active'))
     RETURNING id`,
    [
      userId,
      input.title,
      input.description ?? null,
      input.targetDate ?? null,
      input.status ?? null,
    ],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) {
    throw new Error('INSERT ... RETURNING produced no row');
  }

  const created = await findGoalById(userId, id);
  if (!created) {
    throw new Error('goal vanished immediately after insert');
  }
  return created;
}

export async function findGoalById(
  userId: string,
  goalId: string,
): Promise<GoalWithProgress | undefined> {
  const result = await query<GoalRow>(
    `${SELECT_WITH_PROGRESS} WHERE g.id = $1 AND g.user_id = $2`,
    [goalId, userId],
  );

  const row = result.rows[0];
  return row ? toGoalRecord(row) : undefined;
}

export async function listGoals(
  userId: string,
  limit: number,
  cursor: Cursor | undefined,
  status: GoalStatus | undefined,
): Promise<GoalWithProgress[]> {
  // Both branches are fixed SQL; only values are parameterized. `$3::text IS
  // NULL OR ...` keeps one statement instead of concatenating a clause, so the
  // query text cannot vary with input at all.
  if (cursor) {
    const result = await query<GoalRow>(
      `${SELECT_WITH_PROGRESS}
        WHERE g.user_id = $1
          AND ($2::text IS NULL OR g.status = $2)
          AND (g.created_at, g.id) < ($3, $4)
        ORDER BY g.created_at DESC, g.id DESC
        LIMIT $5`,
      [userId, status ?? null, cursor.createdAt, cursor.id, limit + 1],
    );
    return result.rows.map(toGoalRecord);
  }

  const result = await query<GoalRow>(
    `${SELECT_WITH_PROGRESS}
      WHERE g.user_id = $1
        AND ($2::text IS NULL OR g.status = $2)
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT $3`,
    [userId, status ?? null, limit + 1],
  );
  return result.rows.map(toGoalRecord);
}

export async function updateGoal(
  userId: string,
  goalId: string,
  input: UpdateGoalInput,
): Promise<GoalWithProgress | undefined> {
  const result = await query<{ id: string }>(
    `UPDATE goals
        SET title       = CASE WHEN $3::boolean THEN $4::text ELSE title END,
            description = CASE WHEN $5::boolean THEN $6::text ELSE description END,
            target_date = CASE WHEN $7::boolean THEN $8::date ELSE target_date END,
            status      = CASE WHEN $9::boolean THEN $10::text ELSE status END
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [
      goalId,
      userId,
      input.title !== undefined,
      input.title ?? null,
      input.description !== undefined,
      input.description ?? null,
      input.targetDate !== undefined,
      input.targetDate ?? null,
      input.status !== undefined,
      input.status ?? null,
    ],
  );

  if (result.rowCount === 0) {
    return undefined;
  }
  return findGoalById(userId, goalId);
}

export async function deleteGoal(userId: string, goalId: string): Promise<boolean> {
  // Milestones go with it via ON DELETE CASCADE. A checklist item has no meaning
  // without the goal it belongs to; any task backing one is untouched.
  const result = await query(`DELETE FROM goals WHERE id = $1 AND user_id = $2`, [goalId, userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function listMilestones(userId: string, goalId: string): Promise<MilestoneRecord[]> {
  const result = await query<MilestoneRow>(
    `SELECT m.id, m.goal_id, m.task_id, m.title, ${MILESTONE_DONE} AS is_done,
            m.position, m.created_at, m.updated_at
       FROM milestones m
       LEFT JOIN tasks t ON t.id = m.task_id
      WHERE m.goal_id = $1 AND m.user_id = $2
      ORDER BY m.position ASC, m.created_at ASC`,
    [goalId, userId],
  );
  return result.rows.map(toMilestoneRecord);
}

export async function findMilestoneById(
  userId: string,
  goalId: string,
  milestoneId: string,
): Promise<MilestoneRecord | undefined> {
  const result = await query<MilestoneRow>(
    `SELECT m.id, m.goal_id, m.task_id, m.title, ${MILESTONE_DONE} AS is_done,
            m.position, m.created_at, m.updated_at
       FROM milestones m
       LEFT JOIN tasks t ON t.id = m.task_id
      WHERE m.id = $1 AND m.goal_id = $2 AND m.user_id = $3`,
    [milestoneId, goalId, userId],
  );

  const row = result.rows[0];
  return row ? toMilestoneRecord(row) : undefined;
}

/**
 * Adds a milestone.
 *
 * INSERT ... SELECT so the goal's existence and ownership are tested by the same
 * statement that writes, rather than by a check that ran a moment earlier.
 */
export async function insertMilestone(
  userId: string,
  goalId: string,
  input: CreateMilestoneInput,
): Promise<MilestoneRecord | undefined> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO milestones (goal_id, user_id, task_id, title, position)
     SELECT g.id, g.user_id, $3, $4, coalesce($5, 0)
       FROM goals g
      WHERE g.id = $1 AND g.user_id = $2
     RETURNING id`,
    [goalId, userId, input.taskId ?? null, input.title, input.position ?? null],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) {
    return undefined;
  }
  return findMilestoneById(userId, goalId, id);
}

export async function updateMilestone(
  userId: string,
  goalId: string,
  milestoneId: string,
  input: UpdateMilestoneInput,
): Promise<MilestoneRecord | undefined> {
  const result = await query<{ id: string }>(
    `UPDATE milestones
        SET title    = CASE WHEN $4::boolean THEN $5::text    ELSE title END,
            task_id  = CASE WHEN $6::boolean THEN $7::uuid    ELSE task_id END,
            position = CASE WHEN $8::boolean THEN $9::integer ELSE position END,
            is_done  = CASE WHEN $10::boolean THEN $11::boolean ELSE is_done END
      WHERE id = $1 AND goal_id = $2 AND user_id = $3
      RETURNING id`,
    [
      milestoneId,
      goalId,
      userId,
      input.title !== undefined,
      input.title ?? null,
      input.taskId !== undefined,
      input.taskId ?? null,
      input.position !== undefined,
      input.position ?? null,
      input.isDone !== undefined,
      input.isDone ?? null,
    ],
  );

  if (result.rowCount === 0) {
    return undefined;
  }
  return findMilestoneById(userId, goalId, milestoneId);
}

/**
 * Unlinks a task, keeping the completion state the milestone was displaying.
 *
 * Both statements are in one transaction because they are one change: reading
 * the derived value and then writing it must not be interleaved with a change to
 * the task, or progress would jump backwards for no visible reason.
 */
export async function unlinkMilestoneTask(
  userId: string,
  goalId: string,
  milestoneId: string,
): Promise<MilestoneRecord | undefined> {
  const updated = await withTransaction(async (tx) => {
    const current = await tx.query<{ is_done: boolean }>(
      `SELECT ${MILESTONE_DONE} AS is_done
         FROM milestones m
         LEFT JOIN tasks t ON t.id = m.task_id
        WHERE m.id = $1 AND m.goal_id = $2 AND m.user_id = $3
        FOR UPDATE OF m`,
      [milestoneId, goalId, userId],
    );

    const row = current.rows[0];
    if (!row) {
      return false;
    }

    await tx.query(
      `UPDATE milestones SET task_id = NULL, is_done = $4
        WHERE id = $1 AND goal_id = $2 AND user_id = $3`,
      [milestoneId, goalId, userId, row.is_done],
    );

    return true;
  });

  if (!updated) {
    return undefined;
  }
  return findMilestoneById(userId, goalId, milestoneId);
}

export async function deleteMilestone(
  userId: string,
  goalId: string,
  milestoneId: string,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM milestones WHERE id = $1 AND goal_id = $2 AND user_id = $3`,
    [milestoneId, goalId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Does this task exist and belong to this user? The reference-ownership check. */
export async function taskBelongsToUser(userId: string, taskId: string): Promise<boolean> {
  const result = await query(`SELECT 1 FROM tasks WHERE id = $1 AND user_id = $2`, [
    taskId,
    userId,
  ]);
  return result.rowCount === 1;
}
