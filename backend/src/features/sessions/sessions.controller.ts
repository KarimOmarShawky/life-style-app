/**
 * src/features/sessions/sessions.controller.ts
 *
 * HTTP adapter for GET /api/v1/sessions and POST /api/v1/sessions/:id/revoke.
 * Bodies are validated strictly and never logged.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { SessionsService } from './sessions.service.js';
import { revokeSessionSchema, sessionIdParamsSchema } from './sessions.validation.js';

export class SessionsController {
  constructor(private readonly service: SessionsService) {}

  public list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      res.status(200).json(await this.service.list(req.user.id, req.sessionId));
    } catch (err) {
      next(err);
    }
  };

  /** Runs before the re-authentication limiter: a malformed request spends no budget. */
  public validateRevoke = (req: Request, _res: Response, next: NextFunction): void => {
    try {
      sessionIdParamsSchema.parse(req.params);
      revokeSessionSchema.parse(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };

  public revoke = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = sessionIdParamsSchema.parse(req.params);
      const { currentPassword } = revokeSessionSchema.parse(req.body);
      const result = await this.service.revoke({
        userId: req.user.id,
        currentSessionId: req.sessionId,
        sessionId: id,
        currentPassword,
        meta: {
          ip: req.ip || req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
          requestId: (req as unknown as { requestId?: string }).requestId
        }
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}
