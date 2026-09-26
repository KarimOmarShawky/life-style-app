/**
 * src/features/tasks/tasks.repository.ts
 *
 * Implements Section 4.3 & 6.4: Tasks, Projects, and Timer Sessions Repository Interface.
 */

import type {
  TaskEntity,
  ProjectEntity,
  RecurringTaskEntity,
  TimerSessionEntity
} from './tasks.types.js';

export interface TasksRepository {
  findTaskById(userId: string, taskId: string): Promise<TaskEntity | null>;
  findProjectById(userId: string, projectId: string): Promise<ProjectEntity | null>;
  findRecurringTaskById(
    userId: string,
    recurringTaskId: string
  ): Promise<RecurringTaskEntity | null>;
  findRunningTimerSession(userId: string): Promise<TimerSessionEntity | null>;
}
