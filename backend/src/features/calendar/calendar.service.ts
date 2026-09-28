/**
 * src/features/calendar/calendar.service.ts
 *
 * Implements Section 1.4.7, 6.8 & 14.14–14.15: Events & Reminders Business Logic.
 */

import { AppError } from '../../core/errors/app-error.js';
import { getDayBoundsUtc, getUserTodayDate } from '../../core/time/date-utils.js';
import type { CalendarRepository } from './calendar.repository.js';
import type {
  CreateEventInput,
  UpdateEventInput,
  ListEventsFilter,
  CheckConflictsInput,
  CreateReminderInput
} from './calendar.types.js';
import {
  toEventDto,
  toReminderDto,
  type EventDto,
  type ReminderDto,
  type ConflictResponseDto,
  type AgendaResponseDto
} from './calendar.dto.js';

export class CalendarService {
  constructor(private readonly calendarRepository: CalendarRepository) {}

  private processReminders(
    startAt: Date,
    reminders?: CreateReminderInput[]
  ): Array<{ channel: 'push' | 'in_app' | 'email'; remindAt: Date; offsetMinutes: number | null }> {
    if (!reminders || reminders.length === 0) {
      return [];
    }

    return reminders.map((r, index) => {
      const channel = r.channel ?? 'push';
      let remindAtDate: Date;
      let offset: number | null = null;

      if (r.offsetMinutes !== undefined && r.offsetMinutes !== null) {
        offset = r.offsetMinutes;
        remindAtDate = new Date(startAt.getTime() - offset * 60000);
      } else if (r.remindAt) {
        remindAtDate = new Date(r.remindAt);
        offset = Math.max(0, Math.round((startAt.getTime() - remindAtDate.getTime()) / 60000));
      } else {
        offset = 15;
        remindAtDate = new Date(startAt.getTime() - 15 * 60000);
      }

      if (remindAtDate > startAt) {
        throw AppError.validation([
          {
            field: `reminders[${index}].remindAt`,
            message: 'Reminder cannot be scheduled after event start time'
          }
        ]);
      }

      return {
        channel,
        remindAt: remindAtDate,
        offsetMinutes: offset
      };
    });
  }

  async createEvent(userId: string, input: CreateEventInput): Promise<EventDto> {
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);

    if (endAt < startAt) {
      throw AppError.validation([
        {
          field: 'endAt',
          message: 'endAt must be greater than or equal to startAt'
        }
      ]);
    }

    const processedReminders = this.processReminders(startAt, input.reminders);

    const { event, reminders } = await this.calendarRepository.createEvent(
      userId,
      input,
      processedReminders
    );

    return toEventDto(event, reminders);
  }

  async getEventById(userId: string, eventId: string): Promise<EventDto> {
    const event = await this.calendarRepository.findEventById(userId, eventId);
    if (!event) {
      throw AppError.notFound('Event not found');
    }

    const reminders = await this.calendarRepository.listRemindersForEvent(userId, eventId);
    return toEventDto(event, reminders);
  }

  async listEvents(userId: string, filter: ListEventsFilter): Promise<EventDto[]> {
    if (filter.from && filter.to) {
      if (new Date(filter.to) < new Date(filter.from)) {
        throw AppError.validation([
          {
            field: 'to',
            message: 'to must be greater than or equal to from'
          }
        ]);
      }
    }

    const events = await this.calendarRepository.listEvents(userId, filter);
    return events.map((e) => toEventDto(e));
  }

  async updateEvent(userId: string, eventId: string, input: UpdateEventInput): Promise<EventDto> {
    const existing = await this.calendarRepository.findEventById(userId, eventId);
    if (!existing) {
      throw AppError.notFound('Event not found');
    }

    const effectiveStartAt = input.startAt ? new Date(input.startAt) : existing.startAt;
    const effectiveEndAt = input.endAt ? new Date(input.endAt) : existing.endAt;

    if (effectiveEndAt < effectiveStartAt) {
      throw AppError.validation([
        {
          field: 'endAt',
          message: 'endAt must be greater than or equal to startAt'
        }
      ]);
    }

    const updated = await this.calendarRepository.updateEvent(
      userId,
      eventId,
      input,
      input.version
    );

    if (!updated) {
      const checkExists = await this.calendarRepository.findEventById(userId, eventId);
      if (checkExists) {
        throw AppError.conflict('VERSION_CONFLICT', 'Conflict: Event was modified concurrently');
      }
      throw AppError.notFound('Event not found');
    }

    const reminders = await this.calendarRepository.listRemindersForEvent(userId, eventId);
    return toEventDto(updated, reminders);
  }

  async deleteEvent(userId: string, eventId: string): Promise<void> {
    const deleted = await this.calendarRepository.softDeleteEvent(userId, eventId);
    if (!deleted) {
      throw AppError.notFound('Event not found');
    }
  }

  async restoreEvent(userId: string, eventId: string): Promise<EventDto> {
    const existing = await this.calendarRepository.findEventByIdWithDeleted(userId, eventId);
    if (!existing || existing.deletedAt === null) {
      throw AppError.notFound('Event not found');
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (existing.deletedAt < thirtyDaysAgo) {
      throw new AppError({
        httpStatus: 410,
        code: 'NOT_FOUND',
        safeMessage: 'Event soft-delete restore window (30 days) has expired'
      });
    }

    const restored = await this.calendarRepository.restoreEvent(userId, eventId);
    if (!restored) {
      throw AppError.notFound('Event not found');
    }

    const reminders = await this.calendarRepository.listRemindersForEvent(userId, eventId);
    return toEventDto(restored, reminders);
  }

  async checkConflicts(userId: string, input: CheckConflictsInput): Promise<ConflictResponseDto> {
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);

    if (endAt < startAt) {
      throw AppError.validation([
        {
          field: 'endAt',
          message: 'endAt must be greater than or equal to startAt'
        }
      ]);
    }

    const conflicts = await this.calendarRepository.findConflicts(
      userId,
      startAt,
      endAt,
      input.excludeEventId
    );

    return {
      hasConflict: conflicts.length > 0,
      conflicts: conflicts.map((e) => toEventDto(e))
    };
  }

  async getAgenda(
    userId: string,
    targetDateStr: string | undefined,
    userTimezone = 'UTC'
  ): Promise<AgendaResponseDto> {
    const effectiveDateStr = targetDateStr ?? getUserTodayDate(userTimezone);
    const { startOfDayUtc, endOfDayUtc } = getDayBoundsUtc(effectiveDateStr, userTimezone);

    const events = await this.calendarRepository.listEventsForDay(
      userId,
      startOfDayUtc,
      endOfDayUtc
    );

    return {
      date: effectiveDateStr,
      events: events.map((e) => toEventDto(e)),
      totalEvents: events.length
    };
  }

  async addReminder(
    userId: string,
    eventId: string,
    input: CreateReminderInput
  ): Promise<ReminderDto> {
    const event = await this.calendarRepository.findEventById(userId, eventId);
    if (!event) {
      throw AppError.notFound('Event not found');
    }

    const processed = this.processReminders(event.startAt, [input])[0];
    if (!processed) {
      throw AppError.validation([{ field: 'reminders', message: 'Invalid reminder' }]);
    }

    const reminder = await this.calendarRepository.addReminderToEvent(userId, eventId, processed);
    return toReminderDto(reminder);
  }

  async listReminders(userId: string, eventId: string): Promise<ReminderDto[]> {
    const event = await this.calendarRepository.findEventById(userId, eventId);
    if (!event) {
      throw AppError.notFound('Event not found');
    }

    const reminders = await this.calendarRepository.listRemindersForEvent(userId, eventId);
    return reminders.map(toReminderDto);
  }

  async deleteReminder(userId: string, eventId: string, reminderId: string): Promise<void> {
    const event = await this.calendarRepository.findEventById(userId, eventId);
    if (!event) {
      throw AppError.notFound('Event not found');
    }

    const deleted = await this.calendarRepository.deleteReminder(userId, eventId, reminderId);
    if (!deleted) {
      throw AppError.notFound('Reminder not found');
    }
  }
}
