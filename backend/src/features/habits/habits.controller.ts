/**
 * src/features/habits/habits.controller.ts
 *
 * Implements Section 14.8: Habits Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import type { HabitsService } from './habits.service.js';
import {
  createHabitSchema,
  updateHabitSchema,
  putCheckinSchema,
  getCheckinsQuerySchema,
  listHabitsQuerySchema,
  habitIdParamSchema,
  checkinDateParamSchema
} from './habits.validation.js';
import { AppError } from '../../core/errors/app-error.js';

export class HabitsController {
  constructor(private readonly habitsService: HabitsService) {}

  public listHabits = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listHabitsQuerySchema.parse(req.query);
      const userTimezone = req.user.timezone || 'UTC';
      const result = await this.habitsService.listHabits(req.user.id, query, userTimezone);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public createHabit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = createHabitSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';
      const habit = await this.habitsService.createHabit(req.user.id, input, userTimezone);
      res.status(201).json({ habit });
    } catch (err) {
      next(err);
    }
  };

  public getHabit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = habitIdParamSchema.parse(req.params);
      const userTimezone = req.user.timezone || 'UTC';
      const habit = await this.habitsService.getHabit(req.user.id, id, userTimezone);
      res.status(200).json({ habit });
    } catch (err) {
      next(err);
    }
  };

  public updateHabit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = habitIdParamSchema.parse(req.params);
      const input = updateHabitSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';
      const habit = await this.habitsService.updateHabit(req.user.id, id, input, userTimezone);
      res.status(200).json({ habit });
    } catch (err) {
      next(err);
    }
  };

  public deleteHabit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = habitIdParamSchema.parse(req.params);
      await this.habitsService.deleteHabit(req.user.id, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public restoreHabit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = habitIdParamSchema.parse(req.params);
      const userTimezone = req.user.timezone || 'UTC';
      const habit = await this.habitsService.restoreHabit(req.user.id, id, userTimezone);
      res.status(200).json({ habit });
    } catch (err) {
      next(err);
    }
  };

  public recordCheckin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id, date } = checkinDateParamSchema.parse(req.params);
      const input = putCheckinSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';
      const result = await this.habitsService.recordCheckin(
        req.user.id,
        id,
        date,
        input,
        userTimezone
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public deleteCheckin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id, date } = checkinDateParamSchema.parse(req.params);
      await this.habitsService.deleteCheckin(req.user.id, id, date);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public getCheckins = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = habitIdParamSchema.parse(req.params);
      const query = getCheckinsQuerySchema.parse(req.query);
      const checkins = await this.habitsService.getCheckins(req.user.id, id, query);
      res.status(200).json({ data: checkins });
    } catch (err) {
      next(err);
    }
  };

  public getTodayProgress = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const userTimezone = req.user.timezone || 'UTC';
      const progress = await this.habitsService.getTodayProgress(req.user.id, userTimezone);
      res.status(200).json({ progress });
    } catch (err) {
      next(err);
    }
  };
}
