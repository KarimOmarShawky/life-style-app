/**
 * src/features/search/search.controller.ts
 *
 * HTTP adapter for the Global Search endpoint.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { SearchService } from './search.service.js';
import { searchQuerySchema } from './search.validation.js';

export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  public search = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = searchQuerySchema.parse(req.query);
      const results = await this.searchService.search(req.user.id, query);
      res.status(200).json(results);
    } catch (err) {
      next(err);
    }
  };
}
