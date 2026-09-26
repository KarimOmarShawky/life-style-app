/**
 * src/features/goals/goals.repository.ts
 *
 * Implements Section 4.3 & 6.4: Goals Repository Interface.
 */

import type { GoalEntity, MilestoneEntity } from './goals.types.js';

export interface GoalsRepository {
  findGoalById(userId: string, goalId: string): Promise<GoalEntity | null>;
  listMilestonesByGoal(userId: string, goalId: string): Promise<MilestoneEntity[]>;
}
