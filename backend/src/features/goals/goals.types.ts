/**
 * src/features/goals/goals.types.ts
 *
 * Implements Section 1.4.2, 6.4 & 14.9: Goals & Milestones domain types.
 */

export type GoalStatus = 'active' | 'paused' | 'achieved' | 'abandoned';
export type GoalProgressType = 'milestones' | 'numeric';

export interface GoalEntity {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  progressType: GoalProgressType;
  targetValue: string | null;
  currentValue: string | null;
  unit: string | null;
  startDate: string | null;
  targetDate: string | null;
  achievedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface MilestoneEntity {
  id: string;
  userId: string;
  goalId: string;
  title: string;
  dueDate: string | null;
  completedAt: Date | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface CreateGoalInput {
  title: string;
  description?: string | null | undefined;
  progressType: GoalProgressType;
  targetValue?: string | null | undefined;
  currentValue?: string | null | undefined;
  unit?: string | null | undefined;
  startDate?: string | null | undefined;
  targetDate?: string | null | undefined;
}

export interface UpdateGoalInput {
  title?: string | undefined;
  description?: string | null | undefined;
  status?: GoalStatus | undefined;
  targetValue?: string | null | undefined;
  currentValue?: string | null | undefined;
  unit?: string | null | undefined;
  startDate?: string | null | undefined;
  targetDate?: string | null | undefined;
  version?: number | undefined;
}

export interface ListGoalsFilter {
  status?: GoalStatus | undefined;
  progressType?: GoalProgressType | undefined;
  includeDeleted?: boolean | undefined;
}

export interface CreateMilestoneInput {
  title: string;
  dueDate?: string | null | undefined;
  sortOrder?: number | undefined;
}

export interface UpdateMilestoneInput {
  title?: string | undefined;
  dueDate?: string | null | undefined;
  completed?: boolean | undefined;
  sortOrder?: number | undefined;
  version?: number | undefined;
}
