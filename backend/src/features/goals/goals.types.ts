/**
 * src/features/goals/goals.types.ts
 *
 * Implements Section 6.4 & 14.9: Goals & Milestones domain types.
 */

export interface GoalEntity {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: 'active' | 'paused' | 'achieved' | 'abandoned';
  progressType: 'milestones' | 'numeric';
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
