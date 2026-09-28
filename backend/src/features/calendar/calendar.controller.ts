/**
 * src/features/calendar/calendar.controller.ts
 *
 * Implements Section 14.14–14.15 & AC-CAL-01: Calendar Events HTTP Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { CalendarService } from './calendar.service.js';
import {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
  conflictQuerySchema,
  agendaQuerySchema,
  eventIdParamSchema,
  eventReminderParamSchema,
  createReminderSchema
} from './calendar.validation.js';

export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  public createEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const validated = createEventSchema.parse(req.body);
      const event = await this.calendarService.createEvent(req.user.id, validated);
      res.status(201).json({ event });
    } catch (err) {
      next(err);
    }
  };

  public listEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listEventsQuerySchema.parse(req.query);
      const events = await this.calendarService.listEvents(req.user.id, query);
      res.status(200).json({ events });
    } catch (err) {
      next(err);
    }
  };

  public getEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = eventIdParamSchema.parse(req.params);
      const event = await this.calendarService.getEventById(req.user.id, id);
      res.status(200).json({ event });
    } catch (err) {
      next(err);
    }
  };

  public updateEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = eventIdParamSchema.parse(req.params);
      const validated = updateEventSchema.parse(req.body);
      const event = await this.calendarService.updateEvent(req.user.id, id, validated);
      res.status(200).json({ event });
    } catch (err) {
      next(err);
    }
  };

  public deleteEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = eventIdParamSchema.parse(req.params);
      await this.calendarService.deleteEvent(req.user.id, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  };

  public restoreEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = eventIdParamSchema.parse(req.params);
      const event = await this.calendarService.restoreEvent(req.user.id, id);
      res.status(200).json({ event });
    } catch (err) {
      next(err);
    }
  };

  public checkConflicts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = conflictQuerySchema.parse(req.query);
      const conflictResult = await this.calendarService.checkConflicts(req.user.id, query);
      res.status(200).json(conflictResult);
    } catch (err) {
      next(err);
    }
  };

  public getAgenda = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = agendaQuerySchema.parse(req.query);
      const userTimezone = req.user.timezone || 'UTC';
      const agenda = await this.calendarService.getAgenda(req.user.id, query.date, userTimezone);
      res.status(200).json(agenda);
    } catch (err) {
      next(err);
    }
  };

  public addReminder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = eventIdParamSchema.parse(req.params);
      const validated = createReminderSchema.parse(req.body);
      const reminder = await this.calendarService.addReminder(req.user.id, id, validated);
      res.status(201).json({ reminder });
    } catch (err) {
      next(err);
    }
  };

  public listReminders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = eventIdParamSchema.parse(req.params);
      const reminders = await this.calendarService.listReminders(req.user.id, id);
      res.status(200).json({ reminders });
    } catch (err) {
      next(err);
    }
  };

  public deleteReminder = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id, reminderId } = eventReminderParamSchema.parse(req.params);
      await this.calendarService.deleteReminder(req.user.id, id, reminderId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  };
}
