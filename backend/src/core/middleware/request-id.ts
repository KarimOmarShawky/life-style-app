/**
 * Assigns a correlation id to every request and opens the async context that
 * carries it (spec section 27).
 *
 * An inbound `x-request-id` is honoured so a trace can span the mobile client
 * and any upstream proxy, but it is length-capped and character-filtered first:
 * the value is echoed in a response header and written into logs, so an
 * unvalidated one is a header-injection and log-forging vector.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { runWithContext } from '@/core/logger';

const HEADER = 'x-request-id';
const MAX_LENGTH = 64;
const SAFE_PATTERN = /^[A-Za-z0-9_-]+$/;

function resolveRequestId(header: unknown): string {
  if (typeof header !== 'string') {
    return randomUUID();
  }

  const trimmed = header.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH || !SAFE_PATTERN.test(trimmed)) {
    return randomUUID();
  }

  return trimmed;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.headers[HEADER]);

  req.requestId = requestId;
  res.setHeader(HEADER, requestId);

  runWithContext({ requestId, startedAt: Date.now() }, () => {
    next();
  });
}
