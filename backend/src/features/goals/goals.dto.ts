/**
 * src/features/goals/goals.dto.ts
 *
 * Implements Section 14.9 & AC-GOAL-01..03: Goals & Milestones DTO Serialization.
 */

import { Decimal } from 'decimal.js';
import type { GoalEntity, MilestoneEntity, GoalStatus, GoalProgressType } from './goals.types.js';

export interface MilestoneDto {
  id: string;
  goalId: string;
  title: string;
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface GoalDto {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  progressType: GoalProgressType;
  targetValue: string | null;
  currentValue: string | null;
  unit: string | null;
  progressPercentage: number;
  totalMilestones?: number | undefined;
  completedMilestones?: number | undefined;
  milestones?: MilestoneDto[] | undefined;
  startDate: string | null;
  targetDate: string | null;
  achievedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function formatDateOnly(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

export function calculateGoalProgress(
  goal: GoalEntity,
  milestones?: MilestoneEntity[]
): { progressPercentage: number; totalMilestones: number; completedMilestones: number } {
  if (goal.progressType === 'numeric') {
    if (!goal.targetValue) {
      return { progressPercentage: 0, totalMilestones: 0, completedMilestones: 0 };
    }
    try {
      const target = new Decimal(goal.targetValue);
      const current = new Decimal(goal.currentValue ?? '0');
      if (target.isZero() || target.isNegative()) {
        return { progressPercentage: 0, totalMilestones: 0, completedMilestones: 0 };
      }
      const rawPct = current.dividedBy(target).times(100).toNumber();
      const progressPercentage = Math.min(100, Math.max(0, Math.round(rawPct * 100) / 100));
      return { progressPercentage, totalMilestones: 0, completedMilestones: 0 };
    } catch {
      return { progressPercentage: 0, totalMilestones: 0, completedMilestones: 0 };
    }
  }

  // Milestones progress
  const ms = milestones ?? [];
  const totalMilestones = ms.length;
  const completedMilestones = ms.filter((m) => m.completedAt !== null).length;
  const progressPercentage =
    totalMilestones === 0 ? 0 : Math.round((completedMilestones / totalMilestones) * 10000) / 100;

  return { progressPercentage, totalMilestones, completedMilestones };
}

export function toMilestoneDto(entity: MilestoneEntity): MilestoneDto {
  return {
    id: entity.id,
    goalId: entity.goalId,
    title: entity.title,
    dueDate: formatDateOnly(entity.dueDate),
    completed: entity.completedAt !== null,
    completedAt:
      entity.completedAt instanceof Date
        ? entity.completedAt.toISOString()
        : entity.completedAt
          ? String(entity.completedAt)
          : null,
    sortOrder: entity.sortOrder,
    version: entity.version,
    createdAt:
      entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
    updatedAt:
      entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : String(entity.updatedAt)
  };
}

export function toGoalDto(goal: GoalEntity, milestones?: MilestoneEntity[]): GoalDto {
  const { progressPercentage, totalMilestones, completedMilestones } = calculateGoalProgress(
    goal,
    milestones
  );

  return {
    id: goal.id,
    userId: goal.userId,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    progressType: goal.progressType,
    targetValue: goal.targetValue,
    currentValue: goal.currentValue,
    unit: goal.unit,
    progressPercentage,
    ...(goal.progressType === 'milestones'
      ? {
          totalMilestones,
          completedMilestones,
          ...(milestones ? { milestones: milestones.map(toMilestoneDto) } : {})
        }
      : {}),
    startDate: formatDateOnly(goal.startDate),
    targetDate: formatDateOnly(goal.targetDate),
    achievedAt:
      goal.achievedAt instanceof Date
        ? goal.achievedAt.toISOString()
        : goal.achievedAt
          ? String(goal.achievedAt)
          : null,
    version: goal.version,
    createdAt:
      goal.createdAt instanceof Date ? goal.createdAt.toISOString() : String(goal.createdAt),
    updatedAt:
      goal.updatedAt instanceof Date ? goal.updatedAt.toISOString() : String(goal.updatedAt),
    deletedAt:
      goal.deletedAt instanceof Date
        ? goal.deletedAt.toISOString()
        : goal.deletedAt
          ? String(goal.deletedAt)
          : null
  };
}
