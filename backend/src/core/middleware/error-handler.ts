/**
 * The single Express error-handling middleware (spec section 25).
 *
 * Every failure in the application converges here. Registered last, after all
 * routes and the 404 handler.
 *
 * What it guarantees:
 *   - Exactly one response shape for every error, matching spec section 59.
 *   - Internal detail (stack, driver message, metadata, cause) is logged, never sent.
 *   - Operational failures log at `warn`, unexpected ones at `error` with a stack.
 *   - Stack traces are withheld in production regardless of the error.
 */
import type { NextFunction, Request, Response } from 'express';

import { normalizeError } from '@/core/errors/normalize';
import { createLogger } from '@/core/logger';
import { isProduction } from '@/config';

const log = createLogger('http.error');

/**
 * Express identifies an error handler by its arity, so `next` must stay in the
 * signature even though it is unused on the terminal path.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Headers already sent means a streaming response failed midway. Nothing can
  // be added to the body, so hand off to Express to destroy the socket.
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = normalizeError(error);
  const requestId = req.requestId;

  const logPayload = {
    err: appError,
    code: appError.code,
    status: appError.status,
    method: req.method,
    path: req.path,
    // metadata is a redaction container, so secrets placed here are scrubbed.
    metadata: appError.metadata,
  };

  if (appError.isOperational && appError.isClientError) {
    log.warn(logPayload, `${appError.code}: ${appError.message}`);
  } else {
    log.error(logPayload, `Unhandled failure: ${appError.code}`);
  }

  if (appError.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }

  const body = appError.toClientJSON(requestId);

  // Stack traces are a development affordance only. In production the client
  // gets the code, the message and the request id, which is enough to report a
  // problem and enough for us to find it in the logs.
  if (!isProduction && appError.stack) {
    const debugBody = {
      ...body,
      error: {
        ...body.error,
        stack: appError.stack.split('\n').map((line) => line.trim()),
      },
    };
    res.status(appError.status).json(debugBody);
    return;
  }

  res.status(appError.status).json(body);
}
