/**
 * src/features/recurring-tasks/recurring-tasks.repository.ts
 *
 * Implements Section 4.3 & 6.4: Recurring Tasks Repository Interface.
 */

import type {
  RecurringTaskRow,
  RecurrenceRow,
  RecurringTaskStatus
} from './recurring-tasks.types.js';
import type { RecurrenceRule } from './recurrence-engine.js';

export interface CreateRecurringTaskDbInput {
  userId: string;
  title: string;
  description?: string | null | undefined;
  projectId?: string | null | undefined;
  priority?: number | undefined;
  estimateMinutes?: number | null | undefined;
  dueTime?: string | null | undefined;
  reminderOffsetMinutes?: number | null | undefined;
  status?: RecurringTaskStatus | undefined;
  recurrence: RecurrenceRule;
}

export interface UpdateRecurringTaskDbInput {
  title?: string | undefined;
  description?: string | null | undefined;
  projectId?: string | null | undefined;
  priority?: number | undefined;
  estimateMinutes?: number | null | undefined;
  dueTime?: string | null | undefined;
  reminderOffsetMinutes?: number | null | undefined;
  status?: RecurringTaskStatus | undefined;
  recurrence?: Partial<RecurrenceRule> | undefined;
}

export interface RecurringTasksRepository {
  createWithRecurrence(
    input: CreateRecurringTaskDbInput,
    userToday: string
  ): Promise<{ recurringTask: RecurringTaskRow; recurrence: RecurrenceRow }>;

  findById(
    userId: string,
    id: string
  ): Promise<{ recurringTask: RecurringTaskRow; recurrence: RecurrenceRow } | null>;

  findActiveById(
    userId: string,
    id: string
  ): Promise<{ recurringTask: RecurringTaskRow; recurrence: RecurrenceRow } | null>;

  update(
    userId: string,
    id: string,
    input: UpdateRecurringTaskDbInput,
    userToday: string,
    expectedVersion?: number
  ): Promise<{ recurringTask: RecurringTaskRow; recurrence: RecurrenceRow } | null>;

  softDelete(userId: string, id: string): Promise<boolean>;

  list(
    userId: string,
    status?: RecurringTaskStatus,
    limit?: number,
    cursor?: string
  ): Promise<{
    items: Array<{ recurringTask: RecurringTaskRow; recurrence: RecurrenceRow }>;
    nextCursor: string | null;
  }>;
}
