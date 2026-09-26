/**
 * src/features/tasks/tasks.types.ts
 *
 * Implements Section 6.4 & 14.4: Tasks Domain Types.
 */

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';

export interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number; // 0=none, 1=low, 2=medium, 3=high
  due_date: Date | string | null;
  due_time: string | null;
  planned_date: Date | string | null;
  is_focus: boolean;
  estimate_minutes: number | null;
  project_id: string | null;
  recurring_task_id: string | null;
  occurrence_date: Date | string | null;
  is_customized: boolean;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null;
  plannedDate: string | null;
  isFocus: boolean;
  estimateMinutes: number | null;
  projectId: string | null;
  recurringTaskId: string | null;
  occurrenceDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  trackedSeconds?: number;
}

export interface ListTasksFilter {
  status?: TaskStatus[] | undefined;
  priority?: number[] | undefined;
  projectId?: string | 'none' | undefined;
  dueFrom?: string | undefined;
  dueTo?: string | undefined;
  plannedDate?: string | undefined;
  overdue?: boolean | undefined;
  isFocus?: boolean | undefined;
  completedFrom?: string | undefined;
  completedTo?: string | undefined;
  sort?: 'dueDate' | 'priority' | 'createdAt' | 'updatedAt' | undefined;
  order?: 'asc' | 'desc' | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}
