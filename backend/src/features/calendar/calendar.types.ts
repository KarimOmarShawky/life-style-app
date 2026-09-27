/**
 * src/features/calendar/calendar.types.ts
 *
 * Implements Section 1.4.7, 6.8 & 14.14–14.15: Events & Reminders domain types.
 */

export interface EventEntity {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface ReminderEntity {
  id: string;
  userId: string;
  taskId: string | null;
  habitId: string | null;
  eventId: string | null;
  subscriptionId: string | null;
  entityType: 'task' | 'habit' | 'event' | 'subscription';
  entityId: string;
  source: 'user' | 'system';
  remindAt: Date;
  offsetMinutes: number | null;
  channel: 'push' | 'in_app' | 'email';
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  nextAttemptAt: Date | null;
  attemptCount: number;
  processingStartedAt: Date | null;
  sentAt: Date | null;
  failedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  dedupeKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReminderInput {
  channel?: 'push' | 'in_app' | 'email' | undefined;
  offsetMinutes?: number | null | undefined;
  remindAt?: Date | string | undefined;
}

export interface CreateEventInput {
  title: string;
  description?: string | null | undefined;
  location?: string | null | undefined;
  startAt: Date | string;
  endAt: Date | string;
  allDay?: boolean | undefined;
  timezone: string;
  reminders?: CreateReminderInput[] | undefined;
}

export interface UpdateEventInput {
  title?: string | undefined;
  description?: string | null | undefined;
  location?: string | null | undefined;
  startAt?: Date | string | undefined;
  endAt?: Date | string | undefined;
  allDay?: boolean | undefined;
  timezone?: string | undefined;
  version?: number | undefined;
}

export interface ListEventsFilter {
  from?: Date | string | undefined;
  to?: Date | string | undefined;
  includeDeleted?: boolean | undefined;
}

export interface CheckConflictsInput {
  startAt: Date | string;
  endAt: Date | string;
  excludeEventId?: string | undefined;
}
