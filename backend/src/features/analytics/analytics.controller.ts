/**
 * src/features/analytics/analytics.controller.ts
 *
 * HTTP adapter for GET /api/v1/analytics?days=7|30|90|365
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import { ANALYTICS_RANGES } from './analytics.types.js';
import type { AnalyticsService } from './analytics.service.js';

export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  public getSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const raw = typeof req.query.days === 'string' ? req.query.days : '7';
      const days = Number(raw);
      if (!ANALYTICS_RANGES.includes(days as (typeof ANALYTICS_RANGES)[number])) {
        throw AppError.validation([
          { field: 'days', message: `days must be one of ${ANALYTICS_RANGES.join(', ')}` }
        ]);
      }
      const timezone = req.user.timezone || 'UTC';
      const analytics = await this.analyticsService.getSummary(req.user.id, timezone, days);
      res.status(200).json({ analytics });
    } catch (err) {
      next(err);
    }
  };
}
