/**
 * src/core/errors/app-error.ts
 *
 * Implements Section 15.2 & 15.4: AppError and Error Code Catalogue.
 * Serves as the single domain exception class for expected operational conditions.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_OR_EXPIRED_CODE'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_REFRESH_TOKEN'
  | 'ACCOUNT_DISABLED'
  | 'ACCOUNT_PENDING_DELETION'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'VERSION_CONFLICT'
  | 'TIMER_ALREADY_RUNNING'
  | 'TIMER_NOT_RUNNING'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SUBSCRIPTION_NOT_ACTIVE'
  | 'ALREADY_PAID_FOR_PERIOD'
  | 'CATEGORY_NAME_TAKEN'
  | 'BUDGET_ALREADY_EXISTS'
  | 'REMINDER_NOT_EDITABLE'
  | 'NOT_DELETED'
  | 'NOT_PENDING_DELETION'
  | 'QUOTA_EXCEEDED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'SMS_FALLBACK_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

export interface FieldError {
  field: string;
  code?: string;
  message: string;
}

export class AppError extends Error {
  public readonly httpStatus: number;
  public readonly code: ErrorCode;
  public readonly safeMessage: string;
  public readonly isOperational: boolean;
  public readonly details?: FieldError[];
  public readonly meta?: Record<string, unknown>;

  constructor(options: {
    httpStatus: number;
    code: ErrorCode;
    safeMessage: string;
    isOperational?: boolean | undefined;
    details?: FieldError[] | undefined;
    meta?: Record<string, unknown> | undefined;
  }) {
    super(options.safeMessage);
    this.name = 'AppError';
    this.httpStatus = options.httpStatus;
    this.code = options.code;
    this.safeMessage = options.safeMessage;
    this.isOperational = options.isOperational ?? true;
    if (options.details) {
      this.details = options.details;
    }
    if (options.meta) {
      this.meta = options.meta;
    }
    Error.captureStackTrace(this, this.constructor);
  }

  // Factory methods for standardized errors
  public static validation(details: FieldError[], safeMessage = 'Validation failed'): AppError {
    return new AppError({
      httpStatus: 400,
      code: 'VALIDATION_ERROR',
      safeMessage,
      details
    });
  }

  public static unauthenticated(
    safeMessage = 'Authentication required',
    code: ErrorCode = 'UNAUTHENTICATED'
  ): AppError {
    return new AppError({
      httpStatus: 401,
      code,
      safeMessage
    });
  }

  public static forbidden(
    safeMessage = 'Action forbidden',
    code: ErrorCode = 'FORBIDDEN'
  ): AppError {
    return new AppError({
      httpStatus: 403,
      code,
      safeMessage
    });
  }

  public static notFound(safeMessage = 'Resource not found'): AppError {
    return new AppError({
      httpStatus: 404,
      code: 'NOT_FOUND',
      safeMessage
    });
  }

  public static conflict(
    code: ErrorCode = 'CONFLICT',
    safeMessage = 'Resource conflict'
  ): AppError {
    return new AppError({
      httpStatus: 409,
      code,
      safeMessage
    });
  }

  public static payloadTooLarge(
    safeMessage = 'Payload exceeds maximum allowed size of 100 KB'
  ): AppError {
    return new AppError({
      httpStatus: 413,
      code: 'PAYLOAD_TOO_LARGE',
      safeMessage
    });
  }

  public static unsupportedMediaType(
    safeMessage = 'Content-Type must be application/json'
  ): AppError {
    return new AppError({
      httpStatus: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      safeMessage
    });
  }

  public static rateLimited(
    retryAfterSeconds: number,
    safeMessage = 'Too many requests'
  ): AppError {
    return new AppError({
      httpStatus: 429,
      code: 'RATE_LIMITED',
      safeMessage,
      meta: { retryAfterSeconds }
    });
  }

  public static database(cause: unknown, safeMessage = 'A database error occurred'): AppError {
    return new AppError({
      httpStatus: 500,
      code: 'INTERNAL_ERROR',
      safeMessage,
      isOperational: false,
      meta: { internalCause: String(cause) }
    });
  }

  public static internal(cause?: unknown, safeMessage = 'Internal server error'): AppError {
    return new AppError({
      httpStatus: 500,
      code: 'INTERNAL_ERROR',
      safeMessage,
      isOperational: false,
      meta: cause ? { internalCause: String(cause) } : undefined
    });
  }

  public static serviceUnavailable(safeMessage = 'Service temporarily unavailable'): AppError {
    return new AppError({
      httpStatus: 503,
      code: 'SERVICE_UNAVAILABLE',
      safeMessage,
      isOperational: true
    });
  }
}
