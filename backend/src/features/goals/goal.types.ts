/**
 * Goal domain types.
 *
 * A goal is an intention with a checklist. The checklist items are milestones,
 * and a milestone may optionally be BACKED BY A TASK, which is the first place
 * two features in this system genuinely reference each other.
 */

export const GOAL_STATUSES = ['active', 'achieved', 'abandoned'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface GoalRecord {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly description: string | null;
  readonly targetDate: string | null;
  readonly status: GoalStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GoalWithProgress extends GoalRecord {
  readonly milestoneCount: number;
  readonly doneMilestoneCount: number;
}

export interface MilestoneRecord {
  readonly id: string;
  readonly goalId: string;
  readonly taskId: string | null;
  readonly title: string;
  /** Derived: the task's completion when one backs it, the stored flag otherwise. */
  readonly isDone: boolean;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MilestoneResponse {
  readonly id: string;
  readonly goalId: string;
  readonly taskId: string | null;
  readonly title: string;
  readonly isDone: boolean;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GoalResponse {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly targetDate: string | null;
  readonly status: GoalStatus;
  readonly milestoneCount: number;
  readonly doneMilestoneCount: number;
  /**
   * Whole percent, or null when there are no milestones.
   *
   * Null rather than 0: a goal with no checklist has undefined progress, and
   * showing "0%" for it claims no progress has been made when nothing has been
   * measured at all.
   */
  readonly progressPercent: number | null;
  readonly isOverdue: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A goal with its checklist, returned by the detail endpoint. */
export interface GoalDetailResponse extends GoalResponse {
  readonly milestones: readonly MilestoneResponse[];
}

export interface CreateGoalInput {
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly targetDate?: string | null | undefined;
  readonly status?: GoalStatus | undefined;
}

export interface UpdateGoalInput {
  readonly title?: string | undefined;
  readonly description?: string | null | undefined;
  readonly targetDate?: string | null | undefined;
  readonly status?: GoalStatus | undefined;
}

export interface CreateMilestoneInput {
  readonly title: string;
  readonly taskId?: string | null | undefined;
  readonly position?: number | undefined;
}

export interface UpdateMilestoneInput {
  readonly title?: string | undefined;
  readonly taskId?: string | null | undefined;
  readonly position?: number | undefined;
  readonly isDone?: boolean | undefined;
}

export interface GoalFilters {
  readonly status?: GoalStatus | undefined;
}
