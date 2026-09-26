/**
 * src/features/calendar/calendar.repository.ts
 *
 * Implements Section 4.3 & 6.8: Events & Reminders Repository Interface.
 */

import type { EventEntity, ReminderEntity } from './calendar.types.js';

export interface CalendarRepository {
  findEventById(userId: string, eventId: string): Promise<EventEntity | null>;
  findReminderById(userId: string, reminderId: string): Promise<ReminderEntity | null>;
}
