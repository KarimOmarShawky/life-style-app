/**
 * src/core/logger/log-minimization.ts
 *
 * Keeps personal data and provider/database values out of operational logs
 * (V-10).
 *
 * Rate-limit keys are built from normalized emails and IP addresses, so logging
 * a raw key writes account identifiers into every log sink that receives it.
 * Throttling diagnostics are still useful, so the key is replaced by a keyed,
 * non-reversible correlation identifier: the same key produces the same id
 * within a process (enough to follow one throttled client), but the id cannot be
 * turned back into an email or IP address. The salt is per process and never
 * logged, so ids are not comparable across replicas or restarts either.
 *
 * Database and unexpected errors are summarized to their structural fields
 * (code, constraint, table, error name, top stack frame). Their messages can
 * embed row values, SQL literals or connection details, so they are not logged.
 */

import { createHmac, randomBytes } from 'node:crypto';

const CORRELATION_SALT = randomBytes(32);

/** Stable-within-process, non-reversible correlation id for a sensitive key. */
export function correlationId(key: string): string {
  return createHmac('sha256', CORRELATION_SALT).update(key).digest('hex').slice(0, 16);
}

export interface ErrorLogSummary {
  errorName: string;
  errorCode?: string;
  constraint?: string;
  table?: string;
  /** First stack frame only: file:line:column, with no message or values. */
  frame?: string;
}

/** Structural summary of an error, safe to log. */
export function summarizeErrorForLog(err: unknown): ErrorLogSummary {
  if (!(err instanceof Error)) {
    return { errorName: typeof err };
  }
  const withCode = err as Error & {
    code?: unknown;
    constraint?: unknown;
    table?: unknown;
  };
  const summary: ErrorLogSummary = { errorName: err.name };

  if (typeof withCode.code === 'string' && /^[0-9A-Z]{5}$/.test(withCode.code)) {
    summary.errorCode = withCode.code;
  }
  if (typeof withCode.constraint === 'string') {
    // Constraint names are identifiers authored by this repository.
    summary.constraint = withCode.constraint.slice(0, 80);
  }
  if (typeof withCode.table === 'string') {
    summary.table = withCode.table.slice(0, 80);
  }

  const frame = err.stack?.split('\n')[1]?.trim();
  if (frame) summary.frame = frame.slice(0, 200);
  return summary;
}
