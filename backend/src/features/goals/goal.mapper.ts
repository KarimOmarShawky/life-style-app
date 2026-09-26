/** Database record to client response (spec section 35). */
import type {
  GoalDetailResponse,
  GoalResponse,
  GoalWithProgress,
  MilestoneRecord,
  MilestoneResponse,
} from './goal.types';

/**
 * Progress as a whole percent, or null when there is nothing to measure.
 *
 * Rounded, never floored: 1 of 3 milestones reads as 33%, and 2 of 3 as 67%
 * rather than 66%. Flooring would let a goal sit at 99% with everything done.
 */
export function progressPercent(done: number, total: number): number | null {
  if (total === 0) {
    return null;
  }
  return Math.round((done / total) * 100);
}

export function toGoalResponse(record: GoalWithProgress, today: string): GoalResponse {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    targetDate: record.targetDate,
    status: record.status,
    milestoneCount: record.milestoneCount,
    doneMilestoneCount: record.doneMilestoneCount,
    progressPercent: progressPercent(record.doneMilestoneCount, record.milestoneCount),
    // Derived rather than stored, so it cannot go stale as the date passes. An
    // achieved or abandoned goal is never overdue: the deadline stopped
    // mattering when the goal stopped being active.
    isOverdue:
      record.status === 'active' && record.targetDate !== null && record.targetDate < today,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toMilestoneResponse(record: MilestoneRecord): MilestoneResponse {
  return {
    id: record.id,
    goalId: record.goalId,
    taskId: record.taskId,
    title: record.title,
    isDone: record.isDone,
    position: record.position,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toGoalDetailResponse(
  record: GoalWithProgress,
  milestones: readonly MilestoneRecord[],
  today: string,
): GoalDetailResponse {
  return {
    ...toGoalResponse(record, today),
    milestones: milestones.map(toMilestoneResponse),
  };
}
