/**
 * Minimize operational diagnostics: database/provider messages, details,
 * stacks, identifiers, and arbitrary rejection values can contain user data.
 * This protects only callers using the summary; it does not configure database,
 * proxy, third-party, or arbitrary application logs.
 */
import { createHmac, randomBytes } from 'node:crypto';

const CORRELATION_SALT = randomBytes(32);

/** Stable-within-process, non-reversible correlation id for a sensitive key. */
export function correlationId(key: string): string {
  return createHmac('sha256', CORRELATION_SALT).update(key).digest('hex').slice(0, 16);
}

// Only fixed values are copied; even error.name, stack frames and database
// identifier fields may contain attacker-controlled or sensitive strings.
const ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'DatabaseError',
  'AppError',
  'ZodError'
]);
const SQL_STATES = new Set([
  '23502',
  '23503',
  '23505',
  '23514',
  '22P02',
  '22007',
  '22008',
  '40001',
  '40P01',
  '08000',
  '08003',
  '08006',
  '57P01',
  '42501',
  'P0001',
  '53300',
  '57014'
]);

export interface ErrorLogSummary {
  errorName: string;
  errorCode?: string;
}

/** No raw message, detail, stack, cause, table, constraint or arbitrary object. */
export function summarizeErrorForLog(err: unknown): ErrorLogSummary {
  try {
    if (!(err instanceof Error)) return { errorName: typeof err };
    const name = err.name;
    const errorName = ERROR_NAMES.has(name) ? name : 'Error';
    const code = (err as Error & { code?: unknown }).code;
    return typeof code === 'string' && SQL_STATES.has(code)
      ? { errorName, errorCode: code }
      : { errorName };
  } catch {
    // Malicious proxies/getters must not make error handling throw another error.
    return { errorName: 'unknown' };
  }
}
