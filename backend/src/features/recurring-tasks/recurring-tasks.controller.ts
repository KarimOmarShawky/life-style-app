/**
 * src/features/recurring-tasks/recurring-tasks.controller.ts
 *
 * Implements Section 14.6: Recurring Tasks Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import type { RecurringTasksService } from './recurring-tasks.service.js';
import {
  createRecurringTaskSchema,
  updateRecurringTaskSchema,
  listRecurringTasksQuerySchema,
  recurringTaskIdParamSchema
} from './recurring-tasks.validation.js';
import { AppError } from '../../core/errors/app-error.js';

export class RecurringTasksController {
  constructor(private readonly recurringTasksService: RecurringTasksService) {}

  public listRecurringTasks = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listRecurringTasksQuerySchema.parse(req.query);
      const result = await this.recurringTasksService.listRecurringTasks(req.user.id, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public createRecurringTask = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = createRecurringTaskSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';
      const recurringTask = await this.recurringTasksService.createRecurringTask(
        req.user.id,
        input,
        userTimezone
      );
      res.status(201).json({ recurringTask });
    } catch (err) {
      next(err);
    }
  };

  public getRecurringTask = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = recurringTaskIdParamSchema.parse(req.params);
      const recurringTask = await this.recurringTasksService.getRecurringTask(req.user.id, id);
      res.status(200).json({ recurringTask });
    } catch (err) {
      next(err);
    }
  };

  public updateRecurringTask = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = recurringTaskIdParamSchema.parse(req.params);
      const input = updateRecurringTaskSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';
      const recurringTask = await this.recurringTasksService.updateRecurringTask(
        req.user.id,
        id,
        input,
        userTimezone
      );
      res.status(200).json({ recurringTask });
    } catch (err) {
      next(err);
    }
  };

  public deleteRecurringTask = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = recurringTaskIdParamSchema.parse(req.params);
      await this.recurringTasksService.deleteRecurringTask(req.user.id, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
