/**
 * src/features/projects/projects.types.ts
 *
 * Implements Section 6.4 & 14.5: Projects Domain Types.
 */

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string | null;
  goal_id: string | null;
  due_date: Date | string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

export interface ProjectTaskCounts {
  open: number;
  done: number;
}

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string | null;
  goalId: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  taskCounts: ProjectTaskCounts;
}
