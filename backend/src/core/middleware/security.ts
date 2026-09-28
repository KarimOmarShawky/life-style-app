/**
 * src/core/middleware/security.ts
 *
 * Implements Section 16.2: HTTP hardening and media-type validation.
 * Configures Helmet headers strictly for a stateless JSON API.
 * Validates Content-Type on mutating requests.
 */

import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-error.js';

export const helmetSecurityMiddleware = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  xContentTypeOptions: true,
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  hidePoweredBy: true,
  hsts:
    process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false
});

/**
 * Validates that mutating requests sending a payload declare application/json Content-Type.
 */
export function enforceJsonContentType(req: Request, _res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const contentLength = req.headers['content-length'];
    const transferEncoding = req.headers['transfer-encoding'];
    const hasBody = (contentLength && parseInt(contentLength, 10) > 0) || Boolean(transferEncoding);

    if (hasBody && !req.is('application/json')) {
      return next(AppError.unsupportedMediaType('Content-Type must be application/json'));
    }
  }
  return next();
}
