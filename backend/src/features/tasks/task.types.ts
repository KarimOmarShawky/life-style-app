/**
 * Task domain types (ERD: Task, TimerSession).
 */
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A row from `tasks`. Internal. */
export interface TaskRecord {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: Date | null;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly isRecurring: boolean;
  readonly recurrenceRule: string | null;
  readonly hasTimer: boolean;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A task plus timer aggregates, computed in SQL. */
export interface TaskWithTimer extends TaskRecord {
  /** Total seconds across all COMPLETED sessions. Excludes a running one. */
  readonly totalTrackedSeconds: number;
  /** The running session, if the timer is going. */
  readonly runningSessionId: string | null;
  readonly runningSessionStartedAt: Date | null;
}

export interface TaskResponse {
  readonly id: string;
  readonly projectId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: string | null;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly isRecurring: boolean;
  readonly recurrenceRule: string | null;
  readonly hasTimer: boolean;
  readonly isOverdue: boolean;
  readonly totalTrackedSeconds: number;
  readonly isTimerRunning: boolean;
  readonly timerStartedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TimerSessionRecord {
  readonly id: string;
  readonly taskId: string;
  readonly startTime: Date;
  readonly endTime: Date | null;
  readonly createdAt: Date;
}

export interface TimerSessionResponse {
  readonly id: string;
  readonly startTime: string;
  readonly endTime: string | null;
  /** Null while the session is still running. */
  readonly durationSeconds: number | null;
}

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly status?: TaskStatus | undefined;
  readonly isRecurring?: boolean | undefined;
  readonly recurrenceRule?: string | null | undefined;
  readonly hasTimer?: boolean | undefined;
}

export interface UpdateTaskInput {
  readonly title?: string | undefined;
  readonly description?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly status?: TaskStatus | undefined;
  readonly isRecurring?: boolean | undefined;
  readonly recurrenceRule?: string | null | undefined;
  readonly hasTimer?: boolean | undefined;
}

export interface TaskFilters {
  readonly status?: TaskStatus | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly projectId?: string | undefined;
  /** Only tasks due at or before this instant. */
  readonly dueBefore?: string | undefined;
  /** Only incomplete tasks whose due date has passed. */
  readonly overdue?: boolean | undefined;
  /** Case-insensitive substring match on the title. */
  readonly search?: string | undefined;
}
