/**
 * src/features/product-events/product-events.controller.ts
 *
 * HTTP adapter for POST /api/v1/product-events. The body is validated
 * strictly and never logged.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { ProductEventsService } from './product-events.service.js';
import { recordProductEventSchema } from './product-events.validation.js';

export class ProductEventsController {
  constructor(private readonly service: ProductEventsService) {}

  public record = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = recordProductEventSchema.parse(req.body);
      const result = await this.service.record(req.user.id, req.user.timezone || 'UTC', input);
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  };
}
