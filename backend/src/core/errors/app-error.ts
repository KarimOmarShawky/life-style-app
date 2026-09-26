/**
 * AppError: the single error type the application throws deliberately.
 *
 * Spec section 24. The central idea is the split between what the CLIENT sees
 * and what the LOGS see:
 *
 *   - `code` and `message` are client-safe and cross the network.
 *   - `metadata` never leaves the process. It is for the log line only, which is
 *     where the offending user id, constraint name or driver code belongs.
 *
 * `isOperational` marks an error we anticipated and handled (bad input, missing
 * row, wrong password). A non-operational error is a bug or a broken dependency:
 * the global handler logs those at `error` level with the stack, and returns a
 * generic message so internals never reach the client (spec section 25).
 */
import { ErrorCode, ERROR_MESSAGE, ERROR_STATUS, type ErrorCodeValue } from './error-codes';

/** A single field-level validation failure, safe to return to the client. */
export interface FieldIssue {
  readonly field: string;
  readonly message: string;
}

export interface AppErrorOptions {
  /** Overrides the default HTTP status for the code. */
  readonly status?: number;
  /** Overrides the default client-safe message. Must not contain internals. */
  readonly message?: string;
  /** Per-field problems. Only ever set for validation failures. */
  readonly issues?: readonly FieldIssue[];
  /** Internal detail for logs. NEVER serialized to the client. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** The underlying error, preserved for the log's stack chain. */
  readonly cause?: unknown;
  /** Expected condition (true) versus bug or broken dependency (false). */
  readonly isOperational?: boolean;
  /** Seconds the client should wait before retrying. Sets Retry-After. */
  readonly retryAfterSeconds?: number;
}

export class AppError extends Error {
  public readonly code: ErrorCodeValue;
  public readonly status: number;
  public readonly issues: readonly FieldIssue[];
  public readonly metadata: Readonly<Record<string, unknown>>;
  public readonly isOperational: boolean;
  public readonly retryAfterSeconds: number | undefined;
  public readonly timestamp: string;

  constructor(code: ErrorCodeValue, options: AppErrorOptions = {}) {
    super(options.message ?? ERROR_MESSAGE[code]);

    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code];
    this.issues = options.issues ?? [];
    this.metadata = options.metadata ?? {};
    this.isOperational = options.isOperational ?? true;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.timestamp = new Date().toISOString();

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }

    Error.captureStackTrace(this, AppError);
  }

  /** True when this error represents a client mistake rather than a server fault. */
  public get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /**
   * The client-facing shape. Note what is absent: metadata, cause, and stack.
   * Serialization is the boundary where internal detail is dropped, so there is
   * no way to leak it by forgetting to strip a field at a call site.
   */
  public toClientJSON(requestId?: string): {
    success: false;
    error: {
      code: ErrorCodeValue;
      message: string;
      issues?: readonly FieldIssue[];
      requestId?: string;
    };
  } {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.issues.length > 0 ? { issues: this.issues } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
      },
    };
  }

  // --- Named constructors -------------------------------------------------
  // These exist so call sites read as intent ("this is a conflict") rather than
  // as configuration, and so the common cases cannot pick a wrong status code.

  static validation(issues: readonly FieldIssue[], message?: string): AppError {
    return new AppError(ErrorCode.VALIDATION_ERROR, {
      issues,
      ...(message !== undefined ? { message } : {}),
    });
  }

  static unauthorized(code: ErrorCodeValue = ErrorCode.UNAUTHORIZED, message?: string): AppError {
    return new AppError(code, { ...(message !== undefined ? { message } : {}) });
  }

  static forbidden(message?: string, metadata?: Readonly<Record<string, unknown>>): AppError {
    return new AppError(ErrorCode.FORBIDDEN, {
      ...(message !== undefined ? { message } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    });
  }

  /**
   * Resource not found.
   *
   * Security note: authorization failures on a resource the caller may not even
   * know exists should also use this, not `forbidden`. Returning 403 for "exists
   * but not yours" and 404 for "does not exist" tells an attacker which ids are
   * real, which is the enumeration half of an IDOR (spec section 16).
   */
  static notFound(resource = 'Resource', metadata?: Readonly<Record<string, unknown>>): AppError {
    return new AppError(ErrorCode.NOT_FOUND, {
      message: `${resource} was not found.`,
      ...(metadata !== undefined ? { metadata } : {}),
    });
  }

  static conflict(message?: string, metadata?: Readonly<Record<string, unknown>>): AppError {
    return new AppError(ErrorCode.CONFLICT, {
      ...(message !== undefined ? { message } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    });
  }

  static rateLimited(retryAfterSeconds: number): AppError {
    return new AppError(ErrorCode.RATE_LIMITED, { retryAfterSeconds });
  }

  static database(cause: unknown, metadata?: Readonly<Record<string, unknown>>): AppError {
    return new AppError(ErrorCode.DATABASE_ERROR, {
      cause,
      isOperational: false,
      ...(metadata !== undefined ? { metadata } : {}),
    });
  }

  static internal(cause?: unknown, metadata?: Readonly<Record<string, unknown>>): AppError {
    return new AppError(ErrorCode.INTERNAL_ERROR, {
      isOperational: false,
      ...(cause !== undefined ? { cause } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    });
  }

  static serviceUnavailable(service: string): AppError {
    return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      metadata: { service },
      isOperational: true,
    });
  }
}

/** Type guard usable across module boundaries and after a serialization round trip. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
