/**
 * src/features/tasks/tasks.repository.ts
 *
 * Implements Section 4.3 & 6.4: Tasks Repository Interface.
 */

import type { TaskRow, ListTasksFilter } from './tasks.types.js';

export interface CreateTaskDbInput {
  userId: string;
  title: string;
  description?: string | null | undefined;
  status?: TaskRow['status'] | undefined;
  priority?: number | undefined;
  dueDate?: string | null | undefined;
  dueTime?: string | null | undefined;
  plannedDate?: string | null | undefined;
  isFocus?: boolean | undefined;
  estimateMinutes?: number | null | undefined;
  projectId?: string | null | undefined;
  recurringTaskId?: string | null | undefined;
  occurrenceDate?: string | null | undefined;
  isCustomized?: boolean | undefined;
  completedAt?: Date | null | undefined;
}

export interface UpdateTaskDbInput {
  title?: string | undefined;
  description?: string | null | undefined;
  status?: TaskRow['status'] | undefined;
  priority?: number | undefined;
  dueDate?: string | null | undefined;
  dueTime?: string | null | undefined;
  plannedDate?: string | null | undefined;
  isFocus?: boolean | undefined;
  estimateMinutes?: number | null | undefined;
  projectId?: string | null | undefined;
  isCustomized?: boolean | undefined;
  completedAt?: Date | null | undefined;
  version?: number | undefined;
}

export interface TasksRepository {
  create(input: CreateTaskDbInput): Promise<TaskRow>;
  findById(userId: string, id: string): Promise<TaskRow | null>;
  findActiveById(userId: string, id: string): Promise<TaskRow | null>;
  update(
    userId: string,
    id: string,
    input: UpdateTaskDbInput,
    expectedVersion?: number
  ): Promise<TaskRow | null>;
  softDelete(userId: string, id: string): Promise<boolean>;
  restore(userId: string, id: string, maxAgeDays?: number): Promise<TaskRow | null>;
  list(
    userId: string,
    filter: ListTasksFilter,
    userToday: string
  ): Promise<{ tasks: TaskRow[]; nextCursor: string | null }>;
  unfocusAllForDate(userId: string, plannedDate: string, excludeTaskId?: string): Promise<void>;
  cancelRemindersForTask(userId: string, taskId: string): Promise<void>;
  getTrackedSecondsForTask(userId: string, taskId: string): Promise<number>;
  batchInsert(tasks: CreateTaskDbInput[]): Promise<TaskRow[]>;
  updateFutureInstances(
    recurringTaskId: string,
    userId: string,
    fromDate: string,
    updates: {
      title?: string | undefined;
      description?: string | null | undefined;
      priority?: number | undefined;
      estimateMinutes?: number | null | undefined;
      dueTime?: string | null | undefined;
      projectId?: string | null | undefined;
    }
  ): Promise<number>;
}
