/**
 * src/features/tasks/tasks.types.ts
 *
 * Implements Section 6.4 & 14.4–14.7: Tasks, Projects, Recurring Tasks, and Timer Sessions domain types.
 */

export interface TaskEntity {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: number;
  dueDate: string | null;
  dueTime: string | null;
  plannedDate: string | null;
  isFocus: boolean;
  estimateMinutes: number | null;
  projectId: string | null;
  recurringTaskId: string | null;
  occurrenceDate: string | null;
  isCustomized: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface ProjectEntity {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  status: 'active' | 'on_hold' | 'completed' | 'archived';
  color: string | null;
  goalId: string | null;
  dueDate: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface RecurringTaskEntity {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  projectId: string | null;
  priority: number;
  estimateMinutes: number | null;
  dueTime: string | null;
  reminderOffsetMinutes: number | null;
  status: 'active' | 'paused' | 'ended';
  generatedThrough: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface TimerSessionEntity {
  id: string;
  userId: string;
  taskId: string;
  startedAt: Date;
  endedAt: Date | null;
  mode: 'stopwatch' | 'countdown';
  plannedSeconds: number | null;
  endReason: 'stopped' | 'completed' | 'auto_closed' | null;
  createdAt: Date;
  updatedAt: Date;
}
