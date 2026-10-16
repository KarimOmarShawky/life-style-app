/**
 * src/core/logger/logger.ts
 *
 * Implements ADR-022 & Section 16.5: Structured JSON logging with Pino.
 * Automatically injects request context (requestId, userId) from AsyncLocalStorage.
 * Redacts known structured credential fields and complete HTTP body containers.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type DestinationStream } from 'pino';

export interface RequestContext {
  requestId: string;
  userId?: string;
}

export const requestContextStore = new AsyncLocalStorage<RequestContext>();

// Bounded structured schemas, not arbitrary string/recursive secret detection.
// Whole HTTP bodies are suppressed; individual credential fields cover top-level,
// one-level metadata, and two-level token/header objects used by this application.
const SECRET_FIELDS = [
  'password',
  'newPassword',
  'currentPassword',
  'refreshToken',
  'accessToken',
  'token',
  'code',
  'otp',
  'pushToken',
  'password_hash',
  'passwordHash',
  'secret',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'set-cookie',
  'Set-Cookie',
  'apiKey',
  'ingestToken',
  'x-goog-api-key',
  'X-Goog-Api-Key'
];
const REDACTION_PATHS = [
  ...SECRET_FIELDS.flatMap((field) =>
    ['', '*', '*.*'].map((prefix) => `${prefix}[${JSON.stringify(field)}]`)
  ),
  'req.body',
  'request.body',
  'res.body',
  'response.body'
];

/** Same production policy with an optional destination for real configuration tests. */
export function createLogger(destination?: DestinationStream) {
  return pino(
    {
      level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
      redact: {
        paths: REDACTION_PATHS,
        censor: '[REDACTED]'
      },
      formatters: {
        level(label) {
          return { level: label };
        }
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      mixin() {
        const context = requestContextStore.getStore();
        if (context) {
          return {
            requestId: context.requestId,
            ...(context.userId ? { userId: context.userId } : {})
          };
        }
        return {};
      }
    },
    destination
  );
}

export const baseLogger = createLogger();

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>): void {
    if (meta) {
      baseLogger.debug(meta, msg);
    } else {
      baseLogger.debug(msg);
    }
  },
  info(msg: string, meta?: Record<string, unknown>): void {
    if (meta) {
      baseLogger.info(meta, msg);
    } else {
      baseLogger.info(msg);
    }
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    if (meta) {
      baseLogger.warn(meta, msg);
    } else {
      baseLogger.warn(msg);
    }
  },
  error(msg: string, err?: unknown, meta?: Record<string, unknown>): void {
    const errorMeta =
      err instanceof Error
        ? { err: { message: err.message, stack: err.stack, name: err.name }, ...meta }
        : { err, ...meta };
    baseLogger.error(errorMeta, msg);
  },
  fatal(msg: string, err?: unknown, meta?: Record<string, unknown>): void {
    const errorMeta =
      err instanceof Error
        ? { err: { message: err.message, stack: err.stack, name: err.name }, ...meta }
        : { err, ...meta };
    baseLogger.fatal(errorMeta, msg);
  }
};
