/**
 * src/features/ai-reports/ai-reports.controller.ts
 *
 * HTTP adapter for POST /api/v1/ai/reports. The body is validated strictly
 * and never logged.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { AiReportsService } from './ai-reports.service.js';
import { createAiReportSchema } from './ai-reports.validation.js';

export class AiReportsController {
  constructor(private readonly service: AiReportsService) {}

  public create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = createAiReportSchema.parse(req.body);
      const result = await this.service.create(req.user.id, input);
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };
}
