/**
 * src/features/timer-sessions/timer-sessions.controller.ts
 *
 * Implements Section 14.7: Timer Sessions Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import type { TimerSessionsService } from './timer-sessions.service.js';
import {
  createTimerSessionSchema,
  listTimerSessionsQuerySchema,
  timerSessionIdParamSchema
} from './timer-sessions.validation.js';
import { AppError } from '../../core/errors/app-error.js';

export class TimerSessionsController {
  constructor(private readonly timerSessionsService: TimerSessionsService) {}

  public startTimer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = createTimerSessionSchema.parse(req.body);
      const timerSession = await this.timerSessionsService.startTimer(req.user.id, input);
      res.status(201).json({ timerSession });
    } catch (err) {
      next(err);
    }
  };

  public stopTimer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = timerSessionIdParamSchema.parse(req.params);
      const timerSession = await this.timerSessionsService.stopTimer(req.user.id, id);
      res.status(200).json({ timerSession });
    } catch (err) {
      next(err);
    }
  };

  public getActiveTimer = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const timerSession = await this.timerSessionsService.getActiveTimer(req.user.id);
      res.status(200).json({ timerSession });
    } catch (err) {
      next(err);
    }
  };

  public listTimerSessions = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listTimerSessionsQuerySchema.parse(req.query);
      const result = await this.timerSessionsService.listTimerSessions(req.user.id, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public deleteTimerSession = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = timerSessionIdParamSchema.parse(req.params);
      await this.timerSessionsService.deleteTimerSession(req.user.id, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
