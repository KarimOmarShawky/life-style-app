/**
 * src/features/ai-settings/ai-settings.controller.ts
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { AiSettingsService } from './ai-settings.service.js';
import { patchAiSettingsSchema } from './ai-settings.validation.js';

export class AiSettingsController {
  constructor(private readonly service: AiSettingsService) {}

  public get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const view = await this.service.get(userId);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(view);
    } catch (err) {
      next(err);
    }
  };

  public update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const patch = patchAiSettingsSchema.parse(req.body);
      const view = await this.service.update(userId, patch);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(view);
    } catch (err) {
      next(err);
    }
  };

  private requireUserId(req: Request): string {
    if (!req.user) {
      throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
    }
    return req.user.id;
  }
}
