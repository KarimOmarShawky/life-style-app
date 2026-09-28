/**
 * src/core/logger/logger.ts
 *
 * Implements ADR-022 & Section 16.5: Structured JSON logging with Pino.
 * Automatically injects request context (requestId, userId) from AsyncLocalStorage.
 * Strictly redacts all sensitive authentication tokens, passwords, and secrets.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';

export interface RequestContext {
  requestId: string;
  userId?: string;
}

export const requestContextStore = new AsyncLocalStorage<RequestContext>();

// Strict redaction paths per Spec §16.5
const REDACTION_PATHS = [
  'authorization',
  'headers.authorization',
  'cookie',
  'headers.cookie',
  'set-cookie',
  'headers["set-cookie"]',
  'password',
  '*.password',
  'newPassword',
  '*.newPassword',
  'currentPassword',
  '*.currentPassword',
  'refreshToken',
  '*.refreshToken',
  'accessToken',
  '*.accessToken',
  'token',
  '*.token',
  'code',
  '*.code',
  'otp',
  '*.otp',
  'pushToken',
  '*.pushToken',
  'password_hash',
  '*.password_hash',
  'passwordHash',
  '*.passwordHash',
  'secret',
  '*.secret'
];

export const baseLogger = pino({
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
});

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
