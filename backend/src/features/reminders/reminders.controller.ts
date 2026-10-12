/**
 * src/features/reminders/reminders.controller.ts
 *
 * Implements Section 14.13 & FR-REM-01..06: Unified Reminders HTTP controller.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { RemindersService } from './reminders.service.js';
import type { ReminderParentKind, ReminderEntity } from './reminders.types.js';
import {
  parentParamsSchema,
  reminderParamsSchema,
  createReminderSchema,
  listRemindersQuerySchema
} from './reminders.validation.js';

function toDto(reminder: ReminderEntity): Record<string, unknown> {
  return {
    id: reminder.id,
    entityType: reminder.entityType,
    entityId: reminder.entityId,
    source: reminder.source,
    remindAt: reminder.remindAt.toISOString(),
    offsetMinutes: reminder.offsetMinutes,
    channel: reminder.channel,
    status: reminder.status,
    nextAttemptAt: reminder.nextAttemptAt ? reminder.nextAttemptAt.toISOString() : null,
    sentAt: reminder.sentAt ? reminder.sentAt.toISOString() : null,
    dedupeKey: reminder.dedupeKey,
    createdAt: reminder.createdAt.toISOString()
  };
}

export class RemindersController {
  constructor(
    private readonly remindersService: RemindersService,
    private readonly parentKind: ReminderParentKind
  ) {}

  public addReminder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = parentParamsSchema.parse(req.params);
      const body = createReminderSchema.parse(req.body);
      const reminder = await this.remindersService.addReminder(
        req.user.id,
        this.parentKind,
        id,
        body
      );
      res.status(201).json({ reminder: toDto(reminder) });
    } catch (err) {
      next(err);
    }
  };

  public listReminders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = parentParamsSchema.parse(req.params);
      const reminders = await this.remindersService.listForParent(req.user.id, this.parentKind, id);
      res.status(200).json({ reminders: reminders.map(toDto) });
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
      const { id, reminderId } = reminderParamsSchema.parse(req.params);
      await this.remindersService.deleteReminder(req.user.id, this.parentKind, id, reminderId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}

/** Controller for the unified listing route (GET /api/v1/reminders). */
export class UnifiedRemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  public listAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listRemindersQuerySchema.parse(req.query);
      const reminders = await this.remindersService.listAll(req.user.id, query);
      res.status(200).json({ reminders: reminders.map(toDto) });
    } catch (err) {
      next(err);
    }
  };
}
