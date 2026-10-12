/**
 * src/features/days/days.controller.ts
 *
 * HTTP adapter for the Daily Plan endpoints.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { DaysService } from './days.service.js';
import { dayParamSchema } from './days.validation.js';

export class DaysController {
  constructor(private readonly daysService: DaysService) {}

  public getToday = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const timezone = req.user.timezone || 'UTC';
      const day = await this.daysService.getToday(req.user.id, timezone);
      res.status(200).json({ day });
    } catch (err) {
      next(err);
    }
  };

  public getDay = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { date } = dayParamSchema.parse(req.params);
      const timezone = req.user.timezone || 'UTC';
      const day = await this.daysService.getDay(req.user.id, date, timezone);
      res.status(200).json({ day });
    } catch (err) {
      next(err);
    }
  };
}
