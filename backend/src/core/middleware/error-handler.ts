/**
 * src/core/middleware/error-handler.ts
 *
 * Implements Section 15.3: Global Centralized Error Handling.
 * Translates operational AppErrors, Zod validation errors, PostgreSQL database error codes,
 * and body parser errors into safe response envelopes.
 * Completely prevents stack traces, internal paths, and SQL from reaching clients.
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, type FieldError } from '../errors/app-error.js';
import { errorResponse } from '../http/envelope.js';
import { logger } from '../logger/logger.js';

interface PostgresDatabaseError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
}

export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId =
    req.id ||
    (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : 'unknown');

  // 1. AppError (Domain operational errors)
  if (err instanceof AppError) {
    if (err.httpStatus >= 500) {
      logger.error(`AppError [${err.code}]: ${err.message}`, err, {
        code: err.code,
        meta: err.meta,
        path: req.path,
        method: req.method
      });
    } else {
      logger.warn(`AppError [${err.code}]: ${err.message}`, {
        code: err.code,
        status: err.httpStatus,
        path: req.path,
        method: req.method
      });
    }

    if (err.code === 'RATE_LIMITED' && err.meta?.retryAfterSeconds) {
      res.setHeader('Retry-After', String(err.meta.retryAfterSeconds));
    }

    res.status(err.httpStatus).json(
      errorResponse({
        code: err.code,
        message: err.safeMessage,
        requestId,
        details: err.details
      })
    );
    return;
  }

  // 2. Zod validation errors
  if (err instanceof ZodError) {
    const details: FieldError[] = err.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join('.') : 'root',
      code: issue.code,
      message: issue.message
    }));

    logger.warn('Request validation failed', {
      errorCount: details.length,
      path: req.path,
      method: req.method
    });

    res.status(400).json(
      errorResponse({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        requestId,
        details
      })
    );
    return;
  }

  // 3. Body-parser errors
  const maybeBodyError = err as {
    type?: string;
    status?: number;
    statusCode?: number;
    message?: string;
  };
  if (maybeBodyError.type === 'entity.too.large' || maybeBodyError.status === 413) {
    logger.warn('Payload exceeds maximum allowed size (100 KB)', {
      path: req.path,
      method: req.method
    });
    res.status(413).json(
      errorResponse({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Payload exceeds maximum allowed size of 100 KB',
        requestId
      })
    );
    return;
  }

  if (err instanceof SyntaxError && (maybeBodyError.status === 400 || 'body' in maybeBodyError)) {
    logger.warn('Malformed JSON request body', {
      path: req.path,
      method: req.method
    });
    res.status(400).json(
      errorResponse({
        code: 'VALIDATION_ERROR',
        message: 'Malformed JSON payload in request body',
        requestId
      })
    );
    return;
  }

  // 4. PostgreSQL database errors
  const pgErr = err as PostgresDatabaseError;
  if (pgErr.code) {
    logger.error(`PostgreSQL error [${pgErr.code}]: ${pgErr.message}`, pgErr, {
      code: pgErr.code,
      constraint: pgErr.constraint,
      table: pgErr.table
    });

    switch (pgErr.code) {
      // 23505: Unique violation
      case '23505': {
        res.status(409).json(
          errorResponse({
            code: 'CONFLICT',
            message: 'A resource with these details already exists',
            requestId
          })
        );
        return;
      }
      // 23503: Foreign key violation
      case '23503': {
        res.status(400).json(
          errorResponse({
            code: 'VALIDATION_ERROR',
            message: 'Referenced entity does not exist or is not valid',
            requestId
          })
        );
        return;
      }
      // 23514: Check violation
      case '23514': {
        res.status(400).json(
          errorResponse({
            code: 'VALIDATION_ERROR',
            message: 'Supplied data violates database constraints',
            requestId
          })
        );
        return;
      }
      // 40001: Serialization failure, 40P01: Deadlock detected
      case '40001':
      case '40P01': {
        res.status(503).json(
          errorResponse({
            code: 'SERVICE_UNAVAILABLE',
            message: 'Database concurrency conflict; please retry your request',
            requestId
          })
        );
        return;
      }
      // Connection errors (e.g. 57P01 admin shutdown, 08006 connection failure)
      case '08000':
      case '08003':
      case '08006':
      case '57P01': {
        res.status(503).json(
          errorResponse({
            code: 'SERVICE_UNAVAILABLE',
            message: 'Database service is temporarily unavailable',
            requestId
          })
        );
        return;
      }
    }
  }

  // 5. Catch-all: unexpected internal errors
  logger.error('Unhandled internal server error', err, {
    path: req.path,
    method: req.method
  });

  res.status(500).json(
    errorResponse({
      code: 'INTERNAL_ERROR',
      message: (err as Error)?.message || 'Internal server error',
      requestId
    })
  );
}
