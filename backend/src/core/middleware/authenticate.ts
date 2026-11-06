/**
 * src/core/middleware/authenticate.ts
 *
 * Implements Section 8.2.1: Authoritative Access Token & Session Verification Middleware.
 * Enforces verification sequence:
 * 1. Bearer format check
 * 2. HS256 signature, claims, and clock tolerance
 * 3. TOKEN_EXPIRED separation
 * 4. PostgreSQL auth_sessions joined to users validation
 * 5. Lifecycle status check (disabled, pending_deletion exemptions)
 * 6. Request context hydration
 */

import type { Request, Response, NextFunction } from 'express';
import type { TokenService } from '../security/token-service.js';
import type { SessionValidator, AuthenticatedUserContext } from '../security/session-validator.js';
import { AppError } from '../errors/app-error.js';
import { requestContextStore } from '../logger/logger.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUserContext;
      sessionId?: string;
    }
  }
}

// Endpoints accessible while account is in the 14-day deletion grace period (Spec §8.2.1)
const PENDING_DELETION_EXEMPT_ENDPOINTS = [
  { method: 'POST', path: '/api/v1/auth/logout' },
  { method: 'POST', path: '/api/v1/auth/refresh' },
  { method: 'GET', path: '/api/v1/users/me' },
  { method: 'DELETE', path: '/api/v1/users/me/deletion' },
  { method: 'POST', path: '/api/v1/users/me/export' },
  { method: 'POST', path: '/api/v1/users/me/export/archive' }
];

export function createAuthenticateMiddleware(
  tokenService: TokenService,
  sessionValidator: SessionValidator
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Read Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(
          AppError.unauthenticated('Authorization header missing or malformed', 'UNAUTHENTICATED')
        );
      }

      const token = authHeader.slice(7).trim();
      if (!token) {
        return next(AppError.unauthenticated('Bearer token value missing', 'UNAUTHENTICATED'));
      }

      // 2 & 3. Verify HS256 signature, issuer, audience, and exp claims
      const { sub, sid } = await tokenService.verifyAccessToken(token);

      // 4. Load session joined to user from PostgreSQL
      const session = await sessionValidator.validateSession(sid, sub);
      const now = new Date();

      if (!session || session.revokedAt !== null || session.absoluteExpiresAt <= now) {
        return next(
          AppError.unauthenticated('Session is invalid or has been revoked', 'UNAUTHENTICATED')
        );
      }

      // 5. Check user lifecycle status
      const user = session.user;
      if (user.status === 'disabled') {
        return next(
          AppError.forbidden('Account has been disabled by an administrator', 'ACCOUNT_DISABLED')
        );
      }

      if (user.status === 'pending_deletion') {
        const fullPath = req.baseUrl
          ? `${req.baseUrl}${req.path}`
          : req.originalUrl
            ? req.originalUrl.split('?')[0]!
            : req.path;

        const isExempt = PENDING_DELETION_EXEMPT_ENDPOINTS.some(
          (endpoint) => endpoint.method === req.method && fullPath === endpoint.path
        );

        if (!isExempt) {
          return next(
            AppError.forbidden(
              'Account is scheduled for deletion; cancel deletion to resume normal activity',
              'ACCOUNT_PENDING_DELETION'
            )
          );
        }
      }

      // 6. Context hydration
      req.user = user;
      req.sessionId = session.sessionId;

      const currentStore = requestContextStore.getStore();
      if (currentStore) {
        currentStore.userId = user.id;
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
