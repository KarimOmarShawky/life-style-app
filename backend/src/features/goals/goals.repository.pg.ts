/**
 * src/features/goals/goals.repository.pg.ts
 *
 * Implements Section 4.3 & 6.4: Goals & Milestones PostgreSQL Repository.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type { GoalsRepository } from './goals.repository.js';
import type {
  GoalEntity,
  MilestoneEntity,
  CreateGoalInput,
  UpdateGoalInput,
  ListGoalsFilter,
  CreateMilestoneInput,
  UpdateMilestoneInput,
  GoalStatus,
  GoalProgressType
} from './goals.types.js';

interface GoalDbRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  progress_type: GoalProgressType;
  target_value: string | null;
  current_value: string | null;
  unit: string | null;
  start_date: string | null;
  target_date: string | null;
  achieved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

interface MilestoneDbRow {
  id: string;
  user_id: string;
  goal_id: string;
  title: string;
  due_date: string | null;
  completed_at: Date | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  version: number;
}

function toGoalEntity(row: GoalDbRow): GoalEntity {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    status: row.status,
    progressType: row.progress_type,
    targetValue: row.target_value,
    currentValue: row.current_value,
    unit: row.unit,
    startDate: row.start_date,
    targetDate: row.target_date,
    achievedAt:
      row.achieved_at instanceof Date
        ? row.achieved_at
        : row.achieved_at
          ? new Date(row.achieved_at)
          : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    deletedAt:
      row.deleted_at instanceof Date
        ? row.deleted_at
        : row.deleted_at
          ? new Date(row.deleted_at)
          : null,
    version: row.version
  };
}

function toMilestoneEntity(row: MilestoneDbRow): MilestoneEntity {
  return {
    id: row.id,
    userId: row.user_id,
    goalId: row.goal_id,
    title: row.title,
    dueDate: row.due_date,
    completedAt:
      row.completed_at instanceof Date
        ? row.completed_at
        : row.completed_at
          ? new Date(row.completed_at)
          : null,
    sortOrder: row.sort_order,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    version: row.version
  };
}

export class PgGoalsRepository implements GoalsRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async createGoal(userId: string, input: CreateGoalInput): Promise<GoalEntity> {
    const isNumeric = input.progressType === 'numeric';

    const row = (await this.db
      .insertInto('goals')
      .values({
        user_id: userId,
        title: input.title,
        description: input.description ?? null,
        status: 'active',
        progress_type: input.progressType,
        target_value: isNumeric ? (input.targetValue ?? null) : null,
        current_value: isNumeric ? (input.currentValue ?? '0') : null,
        unit: isNumeric ? (input.unit ?? null) : null,
        start_date: input.startDate ?? null,
        target_date: input.targetDate ?? null,
        achieved_at: null
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as unknown as GoalDbRow;

    return toGoalEntity(row);
  }

  async findGoalById(userId: string, goalId: string): Promise<GoalEntity | null> {
    const row = (await this.db
      .selectFrom('goals')
      .selectAll()
      .where('id', '=', goalId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()) as unknown as GoalDbRow | undefined;

    return row ? toGoalEntity(row) : null;
  }

  async findGoalByIdWithDeleted(userId: string, goalId: string): Promise<GoalEntity | null> {
    const row = (await this.db
      .selectFrom('goals')
      .selectAll()
      .where('id', '=', goalId)
      .where('user_id', '=', userId)
      .executeTakeFirst()) as unknown as GoalDbRow | undefined;

    return row ? toGoalEntity(row) : null;
  }

  async listGoals(userId: string, filter: ListGoalsFilter): Promise<GoalEntity[]> {
    let query = this.db.selectFrom('goals').selectAll().where('user_id', '=', userId);

    if (!filter.includeDeleted) {
      query = query.where('deleted_at', 'is', null);
    }

    if (filter.status) {
      query = query.where('status', '=', filter.status);
    }

    if (filter.progressType) {
      query = query.where('progress_type', '=', filter.progressType);
    }

    const rows = (await query.orderBy('created_at', 'desc').execute()) as unknown as GoalDbRow[];

    return rows.map(toGoalEntity);
  }

  async updateGoal(
    userId: string,
    goalId: string,
    input: UpdateGoalInput & { achievedAt?: Date | null | undefined },
    expectedVersion?: number | undefined
  ): Promise<GoalEntity | null> {
    let query = this.db
      .updateTable('goals')
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.targetValue !== undefined ? { target_value: input.targetValue } : {}),
        ...(input.currentValue !== undefined ? { current_value: input.currentValue } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.startDate !== undefined ? { start_date: input.startDate } : {}),
        ...(input.targetDate !== undefined ? { target_date: input.targetDate } : {}),
        ...(input.achievedAt !== undefined ? { achieved_at: input.achievedAt } : {}),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', goalId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);

    if (expectedVersion !== undefined) {
      query = query.where('version', '=', expectedVersion);
    }

    const row = (await query.returningAll().executeTakeFirst()) as unknown as GoalDbRow | undefined;
    return row ? toGoalEntity(row) : null;
  }

  async softDeleteGoal(userId: string, goalId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('goals')
      .set({
        deleted_at: new Date(),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', goalId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async restoreGoal(userId: string, goalId: string): Promise<GoalEntity | null> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const row = (await this.db
      .updateTable('goals')
      .set({
        deleted_at: null,
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', goalId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is not', null)
      .where('deleted_at', '>=', cutoff)
      .returningAll()
      .executeTakeFirst()) as unknown as GoalDbRow | undefined;

    return row ? toGoalEntity(row) : null;
  }

  async createMilestone(
    userId: string,
    goalId: string,
    input: CreateMilestoneInput
  ): Promise<MilestoneEntity> {
    const row = (await this.db
      .insertInto('milestones')
      .values({
        user_id: userId,
        goal_id: goalId,
        title: input.title,
        due_date: input.dueDate ?? null,
        sort_order: input.sortOrder ?? 0,
        completed_at: null
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as unknown as MilestoneDbRow;

    return toMilestoneEntity(row);
  }

  async findMilestoneById(
    userId: string,
    goalId: string,
    milestoneId: string
  ): Promise<MilestoneEntity | null> {
    const row = (await this.db
      .selectFrom('milestones')
      .selectAll()
      .where('id', '=', milestoneId)
      .where('goal_id', '=', goalId)
      .where('user_id', '=', userId)
      .executeTakeFirst()) as unknown as MilestoneDbRow | undefined;

    return row ? toMilestoneEntity(row) : null;
  }

  async listMilestonesByGoal(userId: string, goalId: string): Promise<MilestoneEntity[]> {
    const rows = (await this.db
      .selectFrom('milestones')
      .selectAll()
      .where('goal_id', '=', goalId)
      .where('user_id', '=', userId)
      .orderBy('sort_order', 'asc')
      .orderBy('created_at', 'asc')
      .execute()) as unknown as MilestoneDbRow[];

    return rows.map(toMilestoneEntity);
  }

  async updateMilestone(
    userId: string,
    goalId: string,
    milestoneId: string,
    input: UpdateMilestoneInput & { completedAt?: Date | null | undefined },
    expectedVersion?: number | undefined
  ): Promise<MilestoneEntity | null> {
    let query = this.db
      .updateTable('milestones')
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
        ...(input.completedAt !== undefined ? { completed_at: input.completedAt } : {}),
        ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', milestoneId)
      .where('goal_id', '=', goalId)
      .where('user_id', '=', userId);

    if (expectedVersion !== undefined) {
      query = query.where('version', '=', expectedVersion);
    }

    const row = (await query.returningAll().executeTakeFirst()) as unknown as
      MilestoneDbRow | undefined;
    return row ? toMilestoneEntity(row) : null;
  }

  async deleteMilestone(userId: string, goalId: string, milestoneId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('milestones')
      .where('id', '=', milestoneId)
      .where('goal_id', '=', goalId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }
}
