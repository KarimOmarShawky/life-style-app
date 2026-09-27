/**
 * src/features/goals/goals.service.ts
 *
 * Implements Section 1.4.2, 6.4 & 14.9: Goals & Milestones Business Service.
 */

import { Decimal } from 'decimal.js';
import { AppError } from '../../core/errors/app-error.js';
import type { GoalsRepository } from './goals.repository.js';
import type {
  MilestoneEntity,
  CreateGoalInput,
  UpdateGoalInput,
  ListGoalsFilter,
  CreateMilestoneInput,
  UpdateMilestoneInput,
  GoalStatus
} from './goals.types.js';
import { toGoalDto, toMilestoneDto, type GoalDto, type MilestoneDto } from './goals.dto.js';

export class GoalsService {
  constructor(private readonly goalsRepository: GoalsRepository) {}

  async createGoal(userId: string, input: CreateGoalInput): Promise<GoalDto> {
    if (input.startDate && input.targetDate) {
      if (input.startDate > input.targetDate) {
        throw AppError.validation([
          {
            field: 'targetDate',
            message: 'targetDate must be greater than or equal to startDate'
          }
        ]);
      }
    }

    if (input.progressType === 'numeric') {
      if (!input.targetValue || Number(input.targetValue) <= 0) {
        throw AppError.validation([
          {
            field: 'targetValue',
            message: 'Numeric goals require targetValue to be greater than 0'
          }
        ]);
      }
      if (input.currentValue && Number(input.currentValue) < 0) {
        throw AppError.validation([
          {
            field: 'currentValue',
            message: 'currentValue must be greater than or equal to 0'
          }
        ]);
      }
    } else {
      // Milestones goal
      if (input.targetValue || input.currentValue || input.unit) {
        throw AppError.validation([
          {
            field: 'progressType',
            message: 'Milestone goals must not specify targetValue, currentValue, or unit'
          }
        ]);
      }
    }

    const goal = await this.goalsRepository.createGoal(userId, input);
    return toGoalDto(goal);
  }

  async getGoal(userId: string, goalId: string): Promise<GoalDto> {
    const goal = await this.goalsRepository.findGoalById(userId, goalId);
    if (!goal) {
      throw AppError.notFound('Goal not found');
    }

    let milestones: MilestoneEntity[] | undefined;
    if (goal.progressType === 'milestones') {
      milestones = await this.goalsRepository.listMilestonesByGoal(userId, goalId);
    }

    return toGoalDto(goal, milestones);
  }

  async listGoals(userId: string, filter: ListGoalsFilter): Promise<GoalDto[]> {
    const goals = await this.goalsRepository.listGoals(userId, filter);

    const result: GoalDto[] = [];
    for (const goal of goals) {
      let milestones: MilestoneEntity[] | undefined;
      if (goal.progressType === 'milestones') {
        milestones = await this.goalsRepository.listMilestonesByGoal(userId, goal.id);
      }
      result.push(toGoalDto(goal, milestones));
    }

    return result;
  }

  async updateGoal(userId: string, goalId: string, input: UpdateGoalInput): Promise<GoalDto> {
    const existing = await this.goalsRepository.findGoalById(userId, goalId);
    if (!existing) {
      throw AppError.notFound('Goal not found');
    }

    const effectiveStartDate = input.startDate !== undefined ? input.startDate : existing.startDate;
    const effectiveTargetDate =
      input.targetDate !== undefined ? input.targetDate : existing.targetDate;

    if (effectiveStartDate && effectiveTargetDate) {
      if (effectiveStartDate > effectiveTargetDate) {
        throw AppError.validation([
          {
            field: 'targetDate',
            message: 'targetDate must be greater than or equal to startDate'
          }
        ]);
      }
    }

    if (existing.progressType === 'milestones') {
      if (
        input.targetValue !== undefined ||
        input.currentValue !== undefined ||
        input.unit !== undefined
      ) {
        throw AppError.validation([
          {
            field: 'progressType',
            message: 'Cannot set targetValue, currentValue, or unit on a milestone-type goal'
          }
        ]);
      }
    }

    let effectiveStatus: GoalStatus = input.status ?? existing.status;
    let achievedAt: Date | null | undefined;

    if (input.status !== undefined) {
      if (input.status === 'achieved' && existing.status !== 'achieved') {
        achievedAt = new Date();
      } else if (input.status !== 'achieved' && existing.status === 'achieved') {
        achievedAt = null;
      }
    } else {
      // Auto-achievement for numeric goals
      if (existing.progressType === 'numeric') {
        const effectiveTarget =
          input.targetValue !== undefined ? input.targetValue : existing.targetValue;
        const effectiveCurrent =
          input.currentValue !== undefined ? input.currentValue : existing.currentValue;

        if (effectiveTarget && effectiveCurrent) {
          try {
            const targetDec = new Decimal(effectiveTarget);
            const currentDec = new Decimal(effectiveCurrent);
            if (currentDec.greaterThanOrEqualTo(targetDec) && existing.status === 'active') {
              effectiveStatus = 'achieved';
              achievedAt = new Date();
            } else if (currentDec.lessThan(targetDec) && existing.status === 'achieved') {
              effectiveStatus = 'active';
              achievedAt = null;
            }
          } catch {
            // ignore calculation failure
          }
        }
      }
    }

    const updatePayload = {
      ...input,
      status: effectiveStatus,
      ...(achievedAt !== undefined ? { achievedAt } : {})
    };

    const updated = await this.goalsRepository.updateGoal(
      userId,
      goalId,
      updatePayload,
      input.version
    );

    if (!updated) {
      const checkExists = await this.goalsRepository.findGoalById(userId, goalId);
      if (checkExists) {
        throw AppError.conflict('VERSION_CONFLICT', 'Conflict: Goal was modified concurrently');
      }
      throw AppError.notFound('Goal not found');
    }

    let milestones: MilestoneEntity[] | undefined;
    if (updated.progressType === 'milestones') {
      milestones = await this.goalsRepository.listMilestonesByGoal(userId, goalId);
    }

    return toGoalDto(updated, milestones);
  }

  async deleteGoal(userId: string, goalId: string): Promise<void> {
    const deleted = await this.goalsRepository.softDeleteGoal(userId, goalId);
    if (!deleted) {
      throw AppError.notFound('Goal not found');
    }
  }

  async restoreGoal(userId: string, goalId: string): Promise<GoalDto> {
    const existing = await this.goalsRepository.findGoalByIdWithDeleted(userId, goalId);
    if (!existing || existing.deletedAt === null) {
      throw AppError.notFound('Goal not found');
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (existing.deletedAt < thirtyDaysAgo) {
      throw new AppError({
        httpStatus: 410,
        code: 'NOT_FOUND',
        safeMessage: 'Goal soft-delete restore window (30 days) has expired'
      });
    }

    const restored = await this.goalsRepository.restoreGoal(userId, goalId);
    if (!restored) {
      throw AppError.notFound('Goal not found');
    }

    let milestones: MilestoneEntity[] | undefined;
    if (restored.progressType === 'milestones') {
      milestones = await this.goalsRepository.listMilestonesByGoal(userId, goalId);
    }

    return toGoalDto(restored, milestones);
  }

  // Milestones methods
  async createMilestone(
    userId: string,
    goalId: string,
    input: CreateMilestoneInput
  ): Promise<MilestoneDto> {
    const goal = await this.goalsRepository.findGoalById(userId, goalId);
    if (!goal) {
      throw AppError.notFound('Goal not found');
    }

    if (goal.progressType !== 'milestones') {
      throw AppError.validation([
        {
          field: 'progressType',
          message: 'Milestones can only be added to milestone-type goals'
        }
      ]);
    }

    const milestone = await this.goalsRepository.createMilestone(userId, goalId, input);

    // If goal was achieved and now a new open milestone is added, reopen goal
    if (goal.status === 'achieved') {
      await this.goalsRepository.updateGoal(userId, goalId, {
        status: 'active',
        achievedAt: null
      });
    }

    return toMilestoneDto(milestone);
  }

  async listMilestones(userId: string, goalId: string): Promise<MilestoneDto[]> {
    const goal = await this.goalsRepository.findGoalById(userId, goalId);
    if (!goal) {
      throw AppError.notFound('Goal not found');
    }

    const milestones = await this.goalsRepository.listMilestonesByGoal(userId, goalId);
    return milestones.map(toMilestoneDto);
  }

  async getMilestone(userId: string, goalId: string, milestoneId: string): Promise<MilestoneDto> {
    const goal = await this.goalsRepository.findGoalById(userId, goalId);
    if (!goal) {
      throw AppError.notFound('Goal not found');
    }

    const milestone = await this.goalsRepository.findMilestoneById(userId, goalId, milestoneId);
    if (!milestone) {
      throw AppError.notFound('Milestone not found');
    }

    return toMilestoneDto(milestone);
  }

  async updateMilestone(
    userId: string,
    goalId: string,
    milestoneId: string,
    input: UpdateMilestoneInput
  ): Promise<MilestoneDto> {
    const goal = await this.goalsRepository.findGoalById(userId, goalId);
    if (!goal) {
      throw AppError.notFound('Goal not found');
    }

    const existing = await this.goalsRepository.findMilestoneById(userId, goalId, milestoneId);
    if (!existing) {
      throw AppError.notFound('Milestone not found');
    }

    let completedAt: Date | null | undefined;
    if (input.completed !== undefined) {
      if (input.completed && existing.completedAt === null) {
        completedAt = new Date();
      } else if (!input.completed && existing.completedAt !== null) {
        completedAt = null;
      }
    }

    const updatePayload = {
      ...input,
      ...(completedAt !== undefined ? { completedAt } : {})
    };

    const updated = await this.goalsRepository.updateMilestone(
      userId,
      goalId,
      milestoneId,
      updatePayload,
      input.version
    );

    if (!updated) {
      const checkExists = await this.goalsRepository.findMilestoneById(userId, goalId, milestoneId);
      if (checkExists) {
        throw AppError.conflict(
          'VERSION_CONFLICT',
          'Conflict: Milestone was modified concurrently'
        );
      }
      throw AppError.notFound('Milestone not found');
    }

    // Auto-achievement evaluation for milestone goals
    if (goal.progressType === 'milestones' && input.completed !== undefined) {
      const allMilestones = await this.goalsRepository.listMilestonesByGoal(userId, goalId);
      const allDone =
        allMilestones.length > 0 && allMilestones.every((m) => m.completedAt !== null);

      if (allDone && goal.status === 'active') {
        await this.goalsRepository.updateGoal(userId, goalId, {
          status: 'achieved',
          achievedAt: new Date()
        });
      } else if (!allDone && goal.status === 'achieved') {
        await this.goalsRepository.updateGoal(userId, goalId, {
          status: 'active',
          achievedAt: null
        });
      }
    }

    return toMilestoneDto(updated);
  }

  async deleteMilestone(userId: string, goalId: string, milestoneId: string): Promise<void> {
    const goal = await this.goalsRepository.findGoalById(userId, goalId);
    if (!goal) {
      throw AppError.notFound('Goal not found');
    }

    const deleted = await this.goalsRepository.deleteMilestone(userId, goalId, milestoneId);
    if (!deleted) {
      throw AppError.notFound('Milestone not found');
    }
  }
}
