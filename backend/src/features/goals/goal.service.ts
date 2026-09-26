/**
 * Goal business logic.
 *
 * Three rules carry this feature:
 *
 *   1. A milestone may be backed by a task, and that task must belong to the
 *      same user. Checked with one query that tests existence and ownership
 *      together, reported as 422 with a message identical in both cases so it
 *      cannot be used to probe for ids (DD-014).
 *   2. A task may back AT MOST ONE milestone. The database enforces it with a
 *      partial unique index; this layer turns the violation into a 409 instead
 *      of a 500.
 *   3. A milestone backed by a task takes its completion FROM that task. Setting
 *      `isDone` directly on such a milestone is refused, because the value would
 *      be ignored on every subsequent read and the client would believe it had
 *      taken effect.
 */
import { AppError, ErrorCode } from '@/core/errors';
import { buildPage, type Page, type PageRequest } from '@/core/utils/pagination';

import * as repository from './goal.repository';
import { toGoalDetailResponse, toGoalResponse, toMilestoneResponse } from './goal.mapper';
import type {
  CreateGoalInput,
  CreateMilestoneInput,
  GoalDetailResponse,
  GoalResponse,
  GoalStatus,
  MilestoneResponse,
  UpdateGoalInput,
  UpdateMilestoneInput,
} from './goal.types';

/** Today, as the server's calendar date, for the overdue comparison. */
export function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** PostgreSQL unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === UNIQUE_VIOLATION;
}

export class GoalService {
  private async assertTaskUsable(userId: string, taskId: string | null | undefined): Promise<void> {
    if (typeof taskId !== 'string') {
      return;
    }

    const usable = await repository.taskBelongsToUser(userId, taskId);
    if (!usable) {
      throw AppError.validation([
        { field: 'taskId', message: 'taskId does not refer to one of your tasks' },
      ]);
    }
  }

  public async create(userId: string, input: CreateGoalInput): Promise<GoalResponse> {
    const goal = await repository.insertGoal(userId, input);
    return toGoalResponse(goal, serverToday());
  }

  public async getById(userId: string, goalId: string): Promise<GoalDetailResponse> {
    const goal = await repository.findGoalById(userId, goalId);
    if (!goal) {
      throw AppError.notFound('Goal', { requestedId: goalId, requestedBy: userId });
    }

    const milestones = await repository.listMilestones(userId, goalId);
    return toGoalDetailResponse(goal, milestones, serverToday());
  }

  public async list(
    userId: string,
    page: PageRequest,
    status: GoalStatus | undefined,
  ): Promise<Page<GoalResponse>> {
    const rows = await repository.listGoals(userId, page.limit, page.cursor, status);
    const paged = buildPage(rows, page.limit);

    // One `today` for the whole page, so two goals with the same target date
    // cannot disagree about whether they are overdue.
    const today = serverToday();

    return {
      items: paged.items.map((goal) => toGoalResponse(goal, today)),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
    };
  }

  public async update(
    userId: string,
    goalId: string,
    input: UpdateGoalInput,
  ): Promise<GoalResponse> {
    const updated = await repository.updateGoal(userId, goalId, input);
    if (!updated) {
      throw AppError.notFound('Goal', { requestedId: goalId, requestedBy: userId });
    }
    return toGoalResponse(updated, serverToday());
  }

  public async remove(userId: string, goalId: string): Promise<void> {
    const deleted = await repository.deleteGoal(userId, goalId);
    if (!deleted) {
      throw AppError.notFound('Goal', { requestedId: goalId, requestedBy: userId });
    }
  }

  public async addMilestone(
    userId: string,
    goalId: string,
    input: CreateMilestoneInput,
  ): Promise<MilestoneResponse> {
    await this.assertTaskUsable(userId, input.taskId);

    try {
      const milestone = await repository.insertMilestone(userId, goalId, input);
      if (!milestone) {
        throw AppError.notFound('Goal', { requestedId: goalId, requestedBy: userId });
      }
      return toMilestoneResponse(milestone);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ErrorCode.CONFLICT, {
          message: 'That task already backs another milestone.',
          metadata: { goalId, taskId: input.taskId },
        });
      }
      throw error;
    }
  }

  public async updateMilestone(
    userId: string,
    goalId: string,
    milestoneId: string,
    input: UpdateMilestoneInput,
  ): Promise<MilestoneResponse> {
    await this.assertTaskUsable(userId, input.taskId);

    const existing = await repository.findMilestoneById(userId, goalId, milestoneId);
    if (!existing) {
      throw AppError.notFound('Milestone', { requestedId: milestoneId, requestedBy: userId });
    }

    // Would this milestone be task-backed after the update? Absent means
    // unchanged, null means unlink, an id means link.
    const linkedAfter =
      input.taskId === undefined ? existing.taskId !== null : input.taskId !== null;

    if (input.isDone !== undefined && linkedAfter) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'This milestone is completed by its task. Change the task instead.',
        metadata: { milestoneId, taskId: input.taskId ?? existing.taskId },
      });
    }

    // Unlinking keeps the completion the milestone was displaying, so progress
    // does not jump backwards when a task is detached.
    if (input.taskId === null && existing.taskId !== null) {
      const unlinked = await repository.unlinkMilestoneTask(userId, goalId, milestoneId);
      if (!unlinked) {
        throw AppError.notFound('Milestone', { requestedId: milestoneId, requestedBy: userId });
      }

      const { taskId: _ignored, ...rest } = input;
      if (Object.keys(rest).length === 0) {
        return toMilestoneResponse(unlinked);
      }

      const updated = await repository.updateMilestone(userId, goalId, milestoneId, rest);
      if (!updated) {
        throw AppError.notFound('Milestone', { requestedId: milestoneId, requestedBy: userId });
      }
      return toMilestoneResponse(updated);
    }

    try {
      const updated = await repository.updateMilestone(userId, goalId, milestoneId, input);
      if (!updated) {
        throw AppError.notFound('Milestone', { requestedId: milestoneId, requestedBy: userId });
      }
      return toMilestoneResponse(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ErrorCode.CONFLICT, {
          message: 'That task already backs another milestone.',
          metadata: { milestoneId, taskId: input.taskId },
        });
      }
      throw error;
    }
  }

  public async removeMilestone(userId: string, goalId: string, milestoneId: string): Promise<void> {
    const deleted = await repository.deleteMilestone(userId, goalId, milestoneId);
    if (!deleted) {
      throw AppError.notFound('Milestone', { requestedId: milestoneId, requestedBy: userId });
    }
  }
}
