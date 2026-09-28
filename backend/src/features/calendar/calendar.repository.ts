/**
 * src/features/calendar/calendar.repository.ts
 *
 * Implements Section 4.3, 6.8 & 14.14–14.15: Events & Reminders Repository Interface.
 */

import type {
  EventEntity,
  ReminderEntity,
  CreateEventInput,
  UpdateEventInput,
  ListEventsFilter
} from './calendar.types.js';

export interface CalendarRepository {
  createEvent(
    userId: string,
    input: CreateEventInput,
    processedReminders?: Array<{
      channel: 'push' | 'in_app' | 'email';
      remindAt: Date;
      offsetMinutes: number | null;
    }>
  ): Promise<{ event: EventEntity; reminders: ReminderEntity[] }>;

  findEventById(userId: string, eventId: string): Promise<EventEntity | null>;
  findEventByIdWithDeleted(userId: string, eventId: string): Promise<EventEntity | null>;
  listEvents(userId: string, filter: ListEventsFilter): Promise<EventEntity[]>;
  updateEvent(
    userId: string,
    eventId: string,
    input: UpdateEventInput,
    expectedVersion?: number
  ): Promise<EventEntity | null>;
  softDeleteEvent(userId: string, eventId: string): Promise<boolean>;
  restoreEvent(userId: string, eventId: string): Promise<EventEntity | null>;
  findConflicts(
    userId: string,
    startAt: Date,
    endAt: Date,
    excludeEventId?: string
  ): Promise<EventEntity[]>;
  listEventsForDay(userId: string, dayStartUtc: Date, dayEndUtc: Date): Promise<EventEntity[]>;

  addReminderToEvent(
    userId: string,
    eventId: string,
    reminder: {
      channel: 'push' | 'in_app' | 'email';
      remindAt: Date;
      offsetMinutes: number | null;
    }
  ): Promise<ReminderEntity>;
  listRemindersForEvent(userId: string, eventId: string): Promise<ReminderEntity[]>;
  deleteReminder(userId: string, eventId: string, reminderId: string): Promise<boolean>;
  findReminderById(userId: string, reminderId: string): Promise<ReminderEntity | null>;
}
