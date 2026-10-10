/**
 * src/core/middleware/authenticate-ingest.ts
 *
 * Authenticates the Android SMS receiver with an ingest token. The token is looked up by digest,
 * and its session is checked on every request. Logging out, a password change, or an account
 * lock therefore disables the token at once, even if it was never revoked explicitly.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { requestContextStore } from '../logger/logger.js';
import { hashIngestToken, isIngestTokenFormat } from '../security/ingest-token.js';
import type { SessionValidator } from '../security/session-validator.js';
import type { IngestTokenRepository } from '../../features/ingest/ingest.repository.js';

export function createIngestAuthenticateMiddleware(
  ingestTokens: IngestTokenRepository,
  sessionValidator: SessionValidator
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(
          AppError.unauthenticated('Authorization header missing or malformed', 'UNAUTHENTICATED')
        );
      }

      const token = authHeader.slice(7).trim();
      if (!isIngestTokenFormat(token)) {
        return next(AppError.unauthenticated('Ingest token is invalid', 'UNAUTHENTICATED'));
      }

      const record = await ingestTokens.findActiveByHash(hashIngestToken(token));
      if (!record) {
        return next(
          AppError.unauthenticated('Ingest token is invalid or has been revoked', 'UNAUTHENTICATED')
        );
      }

      const session = await sessionValidator.validateSession(record.sessionId, record.userId);
      if (!session || session.revokedAt !== null || session.absoluteExpiresAt <= new Date()) {
        return next(
          AppError.unauthenticated('Session is invalid or has been revoked', 'UNAUTHENTICATED')
        );
      }

      const user = session.user;
      if (user.status === 'disabled') {
        return next(
          AppError.forbidden('Account has been disabled by an administrator', 'ACCOUNT_DISABLED')
        );
      }
      if (user.status === 'pending_deletion') {
        return next(
          AppError.forbidden(
            'Account is scheduled for deletion; cancel deletion to resume normal activity',
            'ACCOUNT_PENDING_DELETION'
          )
        );
      }

      req.user = user;
      req.sessionId = session.sessionId;

      const currentStore = requestContextStore.getStore();
      if (currentStore) {
        currentStore.userId = user.id;
      }

      await ingestTokens.markUsed(record.id);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Dispatches to the ingest-token middleware for `lsi_` bearer tokens and to the
 * normal access-token middleware for everything else, so the SMS analyze route
 * can be called from the background receiver (ingest token) and from the app
 * (access token) without widening what an ingest token can do elsewhere.
 */
export function createIngestOrUserAuthenticateMiddleware(
  authenticateIngest: RequestHandler,
  authenticate: RequestHandler
): RequestHandler {
  return (req, res, next) => {
    const raw = req.headers.authorization;
    const token = raw && raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
    const handler = isIngestTokenFormat(token) ? authenticateIngest : authenticate;
    return handler(req, res, next);
  };
}
