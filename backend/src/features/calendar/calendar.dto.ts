/**
 * src/features/calendar/calendar.dto.ts
 *
 * Implements Section 14.14–14.15 & AC-CAL-01: Calendar Events & Reminders DTO Serialization.
 */

import type { EventEntity, ReminderEntity } from './calendar.types.js';

export interface ReminderDto {
  id: string;
  userId: string;
  eventId: string | null;
  taskId: string | null;
  habitId: string | null;
  subscriptionId: string | null;
  entityType: 'task' | 'habit' | 'event' | 'subscription';
  entityId: string;
  source: 'user' | 'system';
  remindAt: string;
  offsetMinutes: number | null;
  channel: 'push' | 'in_app' | 'email';
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  nextAttemptAt: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventDto {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timezone: string;
  version: number;
  reminders?: ReminderDto[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ConflictResponseDto {
  hasConflict: boolean;
  conflicts: EventDto[];
}

export interface AgendaResponseDto {
  date: string;
  events: EventDto[];
  totalEvents: number;
}

export function toReminderDto(entity: ReminderEntity): ReminderDto {
  return {
    id: entity.id,
    userId: entity.userId,
    eventId: entity.eventId,
    taskId: entity.taskId,
    habitId: entity.habitId,
    subscriptionId: entity.subscriptionId,
    entityType: entity.entityType,
    entityId: entity.entityId,
    source: entity.source,
    remindAt:
      entity.remindAt instanceof Date ? entity.remindAt.toISOString() : String(entity.remindAt),
    offsetMinutes: entity.offsetMinutes,
    channel: entity.channel,
    status: entity.status,
    nextAttemptAt:
      entity.nextAttemptAt instanceof Date
        ? entity.nextAttemptAt.toISOString()
        : entity.nextAttemptAt
          ? String(entity.nextAttemptAt)
          : null,
    attemptCount: entity.attemptCount,
    lastErrorCode: entity.lastErrorCode,
    lastErrorMessage: entity.lastErrorMessage,
    dedupeKey: entity.dedupeKey,
    createdAt:
      entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
    updatedAt:
      entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : String(entity.updatedAt)
  };
}

export function toEventDto(entity: EventEntity, reminders?: ReminderEntity[]): EventDto {
  return {
    id: entity.id,
    userId: entity.userId,
    title: entity.title,
    description: entity.description,
    location: entity.location,
    startAt: entity.startAt instanceof Date ? entity.startAt.toISOString() : String(entity.startAt),
    endAt: entity.endAt instanceof Date ? entity.endAt.toISOString() : String(entity.endAt),
    allDay: entity.allDay,
    timezone: entity.timezone,
    version: entity.version,
    ...(reminders ? { reminders: reminders.map(toReminderDto) } : {}),
    createdAt:
      entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
    updatedAt:
      entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : String(entity.updatedAt),
    deletedAt:
      entity.deletedAt instanceof Date
        ? entity.deletedAt.toISOString()
        : entity.deletedAt
          ? String(entity.deletedAt)
          : null
  };
}
