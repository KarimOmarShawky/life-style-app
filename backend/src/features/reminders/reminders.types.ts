/**
 * src/features/reminders/reminders.types.ts
 *
 * Implements Section 6.8, 14.13 & FR-REM-01..06: Unified Reminders domain types.
 * A reminder belongs to exactly one parent entity (task, habit, event, or
 * subscription) enforced by composite FKs and a CHECK constraint at the
 * database level.
 */

export type ReminderParentKind = 'task' | 'habit' | 'event' | 'subscription';
export type ReminderChannel = 'push' | 'in_app' | 'email';
export type ReminderStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface ReminderEntity {
  id: string;
  userId: string;
  entityType: ReminderParentKind;
  entityId: string;
  source: 'user' | 'system';
  remindAt: Date;
  offsetMinutes: number | null;
  channel: ReminderChannel;
  status: ReminderStatus;
  nextAttemptAt: Date | null;
  attemptCount: number;
  sentAt: Date | null;
  failedAt: Date | null;
  lastErrorCode: string | null;
  dedupeKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReminderRepoInput {
  userId: string;
  parentKind: ReminderParentKind;
  parentId: string;
  source: 'user' | 'system';
  remindAt: Date;
  offsetMinutes: number | null;
  channel: ReminderChannel;
  dedupeKey: string | null;
}

export interface ListRemindersFilter {
  parentKind?: ReminderParentKind | undefined;
  parentId?: string | undefined;
  status?: ReminderStatus | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit: number;
}

export interface UpdateReminderRepoInput {
  remindAt?: Date | undefined;
  offsetMinutes?: number | null | undefined;
  channel?: ReminderChannel | undefined;
}
