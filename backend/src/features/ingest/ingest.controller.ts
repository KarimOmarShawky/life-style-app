/**
 * src/features/ingest/ingest.controller.ts
 *
 * HTTP handlers for issuing and revoking the ingest token (both require a normal
 * access token) and for the SMS fallback analyze route (accepts an ingest token
 * or an access token). The analyze handler never logs candidate text.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import { SmsFallbackUnavailableError } from './sms-fallback-analyzer.js';
import { analyzeSmsRequestSchema } from './ingest.validation.js';
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

  /**
   * POST /ingest/sms/analyze: the Gemini fallback for likely transactions the
   * local parser cannot recognize. High confidence may auto-save on the phone;
   * low confidence must wait for user confirmation in the Money review flow.
   */
  analyzeSms = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = analyzeSmsRequestSchema.parse(req.body);
      const result = await this.ingestService.analyzeCandidate(input);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        status: result.status,
        transaction: result.transaction,
        confidence: result.confidence
      });
    } catch (err) {
      if (err instanceof SmsFallbackUnavailableError) {
        return next(
          new AppError({
            httpStatus: 503,
            code: 'SMS_FALLBACK_UNAVAILABLE',
            safeMessage: 'SMS analysis is temporarily unavailable; retry later',
            isOperational: true
          })
        );
      }
      next(err);
    }
  };
}
