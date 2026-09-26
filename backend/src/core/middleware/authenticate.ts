/**
 * Authentication middleware (spec sections 10 and 16).
 *
 * Answers only "who are you?". Whether that identity may touch a particular
 * resource is a separate decision made by `authorize` or by the service that
 * owns the resource.
 *
 * The token is read from the Authorization header, not from a cookie. For a
 * Flutter client that is the correct choice: the app stores the token in
 * platform secure storage and attaches it explicitly, so there is no ambient
 * credential for a browser to attach automatically and therefore no CSRF surface
 * on the mobile path (spec section 11).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError, ErrorCode } from '@/core/errors';
import { setContextUser } from '@/core/logger';
import type { TokenService } from '@/core/security/token-service';
import { CacheKey, cacheGet } from '@/infrastructure/database/redis/cache';

const BEARER_PREFIX = 'Bearer ';

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
}

export function createAuthenticate(tokens: TokenService): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractBearerToken(req.headers.authorization);

      if (!token) {
        throw new AppError(ErrorCode.UNAUTHORIZED, {
          message: 'An Authorization: Bearer <token> header is required.',
        });
      }

      // Throws TOKEN_EXPIRED or TOKEN_INVALID, both of which the client
      // distinguishes: expired means "refresh", invalid means "sign in again".
      const claims = tokens.verifyAccessToken(token);

      // Logout and reuse detection revoke a session immediately, but an access
      // token already issued stays cryptographically valid until it expires.
      // The denylist closes that window when Redis is available.
      const revoked = await cacheGet<boolean>(CacheKey.revokedSession(claims.sid));
      if (revoked === true) {
        throw new AppError(ErrorCode.TOKEN_REVOKED);
      }

      req.user = {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        sessionId: claims.sid,
        issuedAt: claims.iat,
      };

      // From here every log line in this request carries the user id.
      setContextUser(claims.sub);

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Reads the authenticated user or throws.
 *
 * Controllers call this instead of `req.user!`. The non-null assertion would
 * compile even on a route where `authenticate` was never registered, turning a
 * missing-middleware mistake into a runtime crash on `undefined.id`. This turns
 * the same mistake into a clear 401 and a log line.
 */
export function requireUser(req: Request): NonNullable<Request['user']> {
  if (!req.user) {
    throw new AppError(ErrorCode.UNAUTHORIZED, {
      metadata: { reason: 'requireUser called on a route without the authenticate middleware' },
      isOperational: false,
    });
  }
  return req.user;
}
