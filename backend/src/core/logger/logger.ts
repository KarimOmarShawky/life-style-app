/**
 * Application logger (spec section 26).
 *
 * Pino is used for its low overhead and because it emits newline-delimited JSON,
 * which log aggregators parse without a custom grok pattern. Redaction is
 * configured at the logger, not at call sites, so a developer cannot forget it.
 *
 * Every line automatically carries the active request id and user id via the
 * mixin, which is what makes a production trace reconstructable from one id
 * (spec section 27).
 */
import pino, { type Logger, type LoggerOptions } from 'pino';

import { config, isProduction, isTest } from '@/config';

import { getContext } from './request-context';
import { REDACTION_CENSOR, REDACTION_PATHS } from './redaction';

function buildOptions(): LoggerOptions {
  const base: LoggerOptions = {
    level: isTest ? 'silent' : config.LOG_LEVEL,

    redact: {
      paths: [...REDACTION_PATHS],
      censor: REDACTION_CENSOR,
      remove: false,
    },

    // Attached to every line, evaluated per call.
    mixin() {
      const context = getContext();
      if (!context) {
        return {};
      }
      return {
        requestId: context.requestId,
        ...(context.userId !== undefined ? { userId: context.userId } : {}),
        ...(context.route !== undefined ? { route: context.route } : {}),
      };
    },

    formatters: {
      level(label) {
        return { level: label };
      },
    },

    timestamp: pino.stdTimeFunctions.isoTime,

    base: {
      service: 'lifestyle-api',
      env: config.NODE_ENV,
    },

    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  };

  // Human-readable output in development only. Production always emits JSON.
  if (!isProduction && config.LOG_PRETTY) {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,service,env',
          messageFormat: '{if requestId}[{requestId}] {end}{msg}',
        },
      },
    };
  }

  return base;
}

export const logger: Logger = pino(buildOptions());

/**
 * A child logger tagged with the component that owns it, so logs can be filtered
 * to one subsystem (`component=auth.service`) during an incident.
 */
export function createLogger(component: string): Logger {
  return logger.child({ component });
}

export type { Logger };
