/**
 * src/features/dashboard/dashboard.controller.ts
 *
 * HTTP adapter for the Dashboard overview endpoint.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { DashboardService } from './dashboard.service.js';

export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  public getOverview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const timezone = req.user.timezone || 'UTC';
      const overview = await this.dashboardService.getOverview(req.user.id, timezone);
      res.status(200).json({ overview });
    } catch (err) {
      next(err);
    }
  };
}
