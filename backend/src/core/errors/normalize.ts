/**
 * Translates errors thrown by libraries and drivers into AppError.
 *
 * Spec section 25 requires the global handler to deal with known database and
 * validation errors without leaking internals. Doing that translation here keeps
 * the handler itself short and makes each mapping individually testable.
 *
 * The guiding rule: the driver's own message is treated as INTERNAL. A Postgres
 * unique-violation message names the table, the column and the conflicting
 * value. That belongs in metadata for the log, never in the response.
 */
import { ZodError } from 'zod';

import { AppError, type FieldIssue } from './app-error';
import { ErrorCode } from './error-codes';

/** Postgres SQLSTATE codes we map deliberately. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_NOT_NULL_VIOLATION = '23502';
const PG_CHECK_VIOLATION = '23514';
const PG_INVALID_TEXT_REPRESENTATION = '22P02';
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK_DETECTED = '40P01';
const PG_QUERY_CANCELED = '57014';
const PG_TOO_MANY_CONNECTIONS = '53300';

const MONGO_DUPLICATE_KEY = 11000;

interface PostgresErrorShape {
  code: string;
  constraint?: string;
  table?: string;
  column?: string;
  detail?: string;
}

function isPostgresError(error: unknown): error is Error & PostgresErrorShape {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((error as { code: string }).code)
  );
}

interface MongoErrorShape {
  code?: number;
  name: string;
  keyPattern?: Record<string, unknown>;
  errors?: Record<string, { path?: string; message?: string }>;
  path?: string;
}

function isMongoLikeError(error: unknown): error is Error & MongoErrorShape {
  return (
    error instanceof Error &&
    (error.name === 'ValidationError' ||
      error.name === 'CastError' ||
      error.name === 'MongoServerError' ||
      error.name === 'MongoNetworkError' ||
      error.name === 'MongooseServerSelectionError')
  );
}

/** Zod issue paths are arrays of segments; render them as `address.city` or `tags[0]`. */
function formatZodPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`;
    }
    return acc.length === 0 ? segment : `${acc}.${segment}`;
  }, '');
}

export function zodToFieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    field: formatZodPath(issue.path),
    message: issue.message,
  }));
}

function normalizePostgres(error: Error & PostgresErrorShape): AppError {
  const metadata = {
    driver: 'postgres',
    sqlState: error.code,
    ...(error.constraint !== undefined ? { constraint: error.constraint } : {}),
    ...(error.table !== undefined ? { table: error.table } : {}),
    ...(error.column !== undefined ? { column: error.column } : {}),
  };

  switch (error.code) {
    case PG_UNIQUE_VIOLATION:
      // Generic on purpose. Naming the conflicting column on a users table turns
      // a signup form into an account-enumeration oracle (spec section 23).
      return new AppError(ErrorCode.ALREADY_EXISTS, {
        message: 'A record with these details already exists.',
        metadata,
        cause: error,
      });

    case PG_FOREIGN_KEY_VIOLATION:
      return new AppError(ErrorCode.CONFLICT, {
        message: 'A referenced record does not exist or is still in use.',
        metadata,
        cause: error,
      });

    case PG_NOT_NULL_VIOLATION:
    case PG_CHECK_VIOLATION:
    case PG_INVALID_TEXT_REPRESENTATION:
      // Reaching a database constraint means request validation missed a case.
      // Operational for the client, but worth finding in the logs.
      return new AppError(ErrorCode.VALIDATION_ERROR, {
        message: 'The request contains invalid data.',
        metadata: { ...metadata, note: 'database constraint reached; check request validation' },
        cause: error,
      });

    case PG_SERIALIZATION_FAILURE:
    case PG_DEADLOCK_DETECTED:
      return new AppError(ErrorCode.CONFLICT, {
        message: 'The request conflicted with another operation. Please retry.',
        metadata,
        cause: error,
        retryAfterSeconds: 1,
      });

    case PG_QUERY_CANCELED:
      return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        message: 'The request took too long. Please try again.',
        metadata,
        cause: error,
        isOperational: false,
      });

    case PG_TOO_MANY_CONNECTIONS:
      return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        metadata,
        cause: error,
        isOperational: false,
      });

    default:
      return AppError.database(error, metadata);
  }
}

function normalizeMongo(error: Error & MongoErrorShape): AppError {
  if (error.name === 'ValidationError' && error.errors) {
    const issues: FieldIssue[] = Object.entries(error.errors).map(([field, detail]) => ({
      field: detail.path ?? field,
      message: detail.message ?? 'Invalid value.',
    }));
    return AppError.validation(issues);
  }

  if (error.name === 'CastError') {
    return AppError.validation([
      { field: error.path ?? 'id', message: 'Value has an invalid format.' },
    ]);
  }

  if (error.code === MONGO_DUPLICATE_KEY) {
    return new AppError(ErrorCode.ALREADY_EXISTS, {
      message: 'A record with these details already exists.',
      metadata: { driver: 'mongodb', keyPattern: error.keyPattern },
      cause: error,
    });
  }

  if (error.name === 'MongoNetworkError' || error.name === 'MongooseServerSelectionError') {
    return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      metadata: { driver: 'mongodb', reason: 'connection' },
      cause: error,
      isOperational: false,
    });
  }

  return AppError.database(error, { driver: 'mongodb' });
}

function normalizeJwt(error: Error): AppError | undefined {
  switch (error.name) {
    case 'TokenExpiredError':
      return new AppError(ErrorCode.TOKEN_EXPIRED, { cause: error });
    case 'JsonWebTokenError':
    case 'NotBeforeError':
      return new AppError(ErrorCode.TOKEN_INVALID, { cause: error });
    default:
      return undefined;
  }
}

/** Express's body parser sets `type` and `status` on malformed-body errors. */
function normalizeBodyParser(error: unknown): AppError | undefined {
  if (!(error instanceof Error) || !('type' in error)) {
    return undefined;
  }

  const type = (error as { type?: unknown }).type;

  if (type === 'entity.parse.failed') {
    return new AppError(ErrorCode.MALFORMED_JSON, { cause: error });
  }
  if (type === 'entity.too.large') {
    return new AppError(ErrorCode.PAYLOAD_TOO_LARGE, { cause: error });
  }
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return new AppError(ErrorCode.UNSUPPORTED_MEDIA_TYPE, { cause: error });
  }

  return undefined;
}

/**
 * Converts any thrown value into an AppError.
 *
 * Anything unrecognized becomes a non-operational INTERNAL_ERROR, which the
 * handler logs with a full stack and reports to the client as a generic message.
 * Unrecognized therefore fails closed: a new library error shows up as a 500 in
 * the logs, never as an accidental disclosure.
 */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return AppError.validation(zodToFieldIssues(error));
  }

  const bodyParserError = normalizeBodyParser(error);
  if (bodyParserError) {
    return bodyParserError;
  }

  if (error instanceof Error) {
    const jwtError = normalizeJwt(error);
    if (jwtError) {
      return jwtError;
    }
  }

  if (isMongoLikeError(error)) {
    return normalizeMongo(error);
  }

  if (isPostgresError(error)) {
    return normalizePostgres(error);
  }

  if (error instanceof Error) {
    return AppError.internal(error, { originalName: error.name });
  }

  // A non-Error was thrown. Record its type, not its value: a thrown string or
  // object could itself contain sensitive data.
  return AppError.internal(undefined, { thrownType: typeof error });
}
