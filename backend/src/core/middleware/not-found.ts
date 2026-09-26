/**
 * Terminal 404 handler for unmatched routes.
 *
 * Registered after every route so anything reaching it is genuinely unmatched.
 * It produces an AppError rather than its own response, which keeps the response
 * shape defined in exactly one place: the global error handler.
 */
import type { NextFunction, Request, Response } from 'express';

import { AppError, ErrorCode } from '@/core/errors';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError(ErrorCode.NOT_FOUND, {
      message: `Route ${req.method} ${req.path} does not exist.`,
      metadata: { method: req.method, path: req.path },
    }),
  );
}
