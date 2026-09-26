/**
 * The complete set of error codes the API can return.
 *
 * Spec sections 24 and 59. These codes are a public contract: the Flutter client
 * branches on them, so treat a change to an existing code as a breaking API
 * change. The human-readable message may change freely, the code may not.
 */
export const ErrorCode = {
  // --- Client input -------------------------------------------------------
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MALFORMED_JSON: 'MALFORMED_JSON',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',

  // --- Authentication -----------------------------------------------------
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',

  // --- Authorization ------------------------------------------------------
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',

  // --- Resources ----------------------------------------------------------
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // --- Throttling ---------------------------------------------------------
  RATE_LIMITED: 'RATE_LIMITED',

  // --- Infrastructure -----------------------------------------------------
  DATABASE_ERROR: 'DATABASE_ERROR',
  CACHE_ERROR: 'CACHE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Default HTTP status for each code. A call site may override it, but the
 * default keeps status codes consistent across features without every service
 * having to remember which number goes with which failure.
 */
export const ERROR_STATUS: Readonly<Record<ErrorCodeValue, number>> = {
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.MALFORMED_JSON]: 400,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,

  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.TOKEN_INVALID]: 401,
  [ErrorCode.TOKEN_REVOKED]: 401,
  [ErrorCode.TOKEN_REUSE_DETECTED]: 401,
  [ErrorCode.ACCOUNT_LOCKED]: 423,
  [ErrorCode.ACCOUNT_DISABLED]: 403,

  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 403,

  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.ALREADY_EXISTS]: 409,

  [ErrorCode.RATE_LIMITED]: 429,

  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.CACHE_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

/**
 * Client-safe default messages.
 *
 * Deliberately vague where precision would leak information. `INVALID_CREDENTIALS`
 * never says whether it was the email or the password that was wrong, because
 * that difference is an account-enumeration oracle (spec section 23).
 */
export const ERROR_MESSAGE: Readonly<Record<ErrorCodeValue, string>> = {
  [ErrorCode.VALIDATION_ERROR]: 'The request contains invalid data.',
  [ErrorCode.MALFORMED_JSON]: 'The request body is not valid JSON.',
  [ErrorCode.PAYLOAD_TOO_LARGE]: 'The request body is too large.',
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported content type.',

  [ErrorCode.UNAUTHORIZED]: 'Authentication is required.',
  [ErrorCode.INVALID_CREDENTIALS]: 'Invalid credentials.',
  [ErrorCode.TOKEN_EXPIRED]: 'The token has expired.',
  [ErrorCode.TOKEN_INVALID]: 'The token is invalid.',
  [ErrorCode.TOKEN_REVOKED]: 'The token has been revoked.',
  [ErrorCode.TOKEN_REUSE_DETECTED]: 'Session ended for security reasons. Please sign in again.',
  [ErrorCode.ACCOUNT_LOCKED]: 'Too many failed attempts. Try again later.',
  [ErrorCode.ACCOUNT_DISABLED]: 'This account is not active.',

  [ErrorCode.FORBIDDEN]: 'You do not have access to this resource.',
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 'You do not have permission to perform this action.',

  [ErrorCode.NOT_FOUND]: 'The requested resource was not found.',
  [ErrorCode.CONFLICT]: 'The request conflicts with the current state.',
  [ErrorCode.ALREADY_EXISTS]: 'The resource already exists.',

  [ErrorCode.RATE_LIMITED]: 'Too many requests. Please slow down.',

  [ErrorCode.DATABASE_ERROR]: 'A data storage error occurred.',
  [ErrorCode.CACHE_ERROR]: 'A caching error occurred.',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'The service is temporarily unavailable.',
  [ErrorCode.INTERNAL_ERROR]: 'An unexpected error occurred.',
};
