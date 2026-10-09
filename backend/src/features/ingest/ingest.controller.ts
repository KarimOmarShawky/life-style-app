/**
 * src/features/ingest/ingest.controller.ts
 *
 * HTTP handlers for issuing and revoking the ingest token. Both require a normal access token.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { IngestService } from './ingest.service.js';

export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  issueToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.sessionId) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const token = await this.ingestService.issueForSession(req.user.id, req.sessionId);
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({ token });
    } catch (err) {
      next(err);
    }
  };

  revokeToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.sessionId) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      await this.ingestService.revokeForSession(req.sessionId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  };
}
