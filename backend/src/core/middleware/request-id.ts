/**
 * src/core/middleware/request-id.ts
 *
 * Implements Section 4.6 & 16.5: Request ID handling and AsyncLocalStorage propagation.
 * Validates or assigns a unique UUIDv4 request ID, binds it to the response header,
 * and enters the asynchronous request context for structured logging.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { requestContextStore } from '../logger/logger.js';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

// Regex to validate client-supplied request IDs (alphanumeric, dashes, underscores, 8-64 chars)
const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingHeader = req.headers['x-request-id'];
  let requestId: string;

  if (typeof incomingHeader === 'string' && SAFE_REQUEST_ID_REGEX.test(incomingHeader)) {
    requestId = incomingHeader;
  } else {
    requestId = randomUUID();
  }

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  requestContextStore.run({ requestId }, () => {
    next();
  });
}
