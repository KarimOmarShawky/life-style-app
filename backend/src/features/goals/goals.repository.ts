/**
 * src/features/goals/goals.repository.ts
 *
 * Implements Section 4.3 & 6.4: Goals & Milestones Repository Interface.
 */

import type {
  GoalEntity,
  MilestoneEntity,
  CreateGoalInput,
  UpdateGoalInput,
  ListGoalsFilter,
  CreateMilestoneInput,
  UpdateMilestoneInput
} from './goals.types.js';

export interface GoalsRepository {
  createGoal(userId: string, input: CreateGoalInput): Promise<GoalEntity>;
  findGoalById(userId: string, goalId: string): Promise<GoalEntity | null>;
  findGoalByIdWithDeleted(userId: string, goalId: string): Promise<GoalEntity | null>;
  listGoals(userId: string, filter: ListGoalsFilter): Promise<GoalEntity[]>;
  updateGoal(
    userId: string,
    goalId: string,
    input: UpdateGoalInput & { achievedAt?: Date | null | undefined },
    expectedVersion?: number | undefined
  ): Promise<GoalEntity | null>;
  softDeleteGoal(userId: string, goalId: string): Promise<boolean>;
  restoreGoal(userId: string, goalId: string): Promise<GoalEntity | null>;

  createMilestone(
    userId: string,
    goalId: string,
    input: CreateMilestoneInput
  ): Promise<MilestoneEntity>;
  findMilestoneById(
    userId: string,
    goalId: string,
    milestoneId: string
  ): Promise<MilestoneEntity | null>;
  listMilestonesByGoal(userId: string, goalId: string): Promise<MilestoneEntity[]>;
  updateMilestone(
    userId: string,
    goalId: string,
    milestoneId: string,
    input: UpdateMilestoneInput & { completedAt?: Date | null | undefined },
    expectedVersion?: number | undefined
  ): Promise<MilestoneEntity | null>;
  deleteMilestone(userId: string, goalId: string, milestoneId: string): Promise<boolean>;
}
