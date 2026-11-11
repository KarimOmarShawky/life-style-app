/**
 * src/features/notifications/notification-preferences.controller.ts
 *
 * HTTP adapter for GET and PUT /api/v1/notification-preferences. Bodies are
 * validated strictly and never logged.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { NotificationPreferencesService } from './notification-preferences.service.js';
import { notificationPreferencesSchema } from './notification-preferences.validation.js';

export class NotificationPreferencesController {
  constructor(private readonly service: NotificationPreferencesService) {}

  public get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      res.status(200).json(await this.service.get(req.user.id, req.user.timezone || 'UTC'));
    } catch (err) {
      next(err);
    }
  };

  public replace = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const body = notificationPreferencesSchema.parse(req.body);
      res
        .status(200)
        .json(await this.service.replace(req.user.id, req.user.timezone || 'UTC', body));
    } catch (err) {
      next(err);
    }
  };
}
