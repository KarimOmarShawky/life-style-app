/**
 * Typed API error model with safe, user-facing messages.
 *
 * Security rules enforced here:
 * - Never embed stack traces, SQL, server internals, secrets, request bodies,
 *   or token values in messages.
 * - Backend envelope messages are only surfaced for 4xx responses (the backend
 *   guarantees they are safe, human-readable strings); anything else falls
 *   back to a generic message.
 */

export interface ApiFieldError {
  field: string;
  code?: string;
  message: string;
}

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'redirect' | 'parse';

export interface ApiErrorInit {
  kind: ApiErrorKind;
  status?: number | null;
  code?: string | null;
  /** Raw server-provided message (already safe per backend contract) — used only for 4xx. */
  serverMessage?: string | null;
  requestId?: string | null;
  details?: ApiFieldError[] | null;
  retryable?: boolean;
}

const GENERIC_SERVER_ERROR = 'Unable to reach the server. Check your connection and try again.';
const GENERIC_UNKNOWN = 'Something went wrong. Please try again.';

/** Catalog of safe user-facing messages keyed by backend error code. */
const CODE_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'Please review the highlighted fields.',
  UNAUTHENTICATED: 'Your session has ended. Please sign in again.',
  TOKEN_EXPIRED: 'Your session has expired.',
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  INVALID_REFRESH_TOKEN: 'Your session has ended. Please sign in again.',
  INVALID_OR_EXPIRED_CODE: 'The reset code is invalid or has expired.',
  EMAIL_ALREADY_REGISTERED: 'An account with this email already exists.',
  ACCOUNT_DISABLED: 'This account has been disabled.',
  ACCOUNT_PENDING_DELETION:
    'This account is scheduled for deletion. Cancel the deletion to continue.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested item was not found.',
  CONFLICT: 'This conflicts with the current state. Refresh and try again.',
  VERSION_CONFLICT:
    'This item was changed somewhere else. Refresh to load the latest version before editing again.',
  TIMER_ALREADY_RUNNING: 'Another timer is already running. Stop it before starting a new one.',
  TIMER_NOT_RUNNING: 'No timer is currently running.',
  IDEMPOTENCY_KEY_REUSED: 'This request was already submitted with different details.',
  PAYLOAD_TOO_LARGE: 'The request is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'The request could not be processed.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  SUBSCRIPTION_NOT_ACTIVE: 'This subscription is not active.',
  INTERNAL_ERROR: GENERIC_SERVER_ERROR,
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Please try again shortly.'
};

const STATUS_MESSAGES: Record<number, string> = {
  400: 'The request was invalid. Please review and try again.',
  401: 'Your session has ended. Please sign in again.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested item was not found.',
  409: 'This conflicts with the current state. Refresh and try again.',
  413: 'The request is too large.',
  415: 'The request could not be processed.',
  429: 'Too many requests. Please wait a moment and try again.'
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly details: ApiFieldError[] | null;
  readonly retryable: boolean;
  /** Safe message intended for display to end users. */
  readonly userMessage: string;

  constructor(init: ApiErrorInit) {
    const status = init.status ?? null;
    const code = init.code ?? null;
    const userMessage = resolveUserMessage(init.kind, status, code, init.serverMessage ?? null);
    super(userMessage);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = status;
    this.code = code;
    this.requestId = init.requestId ?? null;
    this.details = init.details ?? null;
    this.retryable =
      init.retryable ??
      (init.kind === 'network' ||
        init.kind === 'timeout' ||
        (status !== null && (status >= 500 || status === 429)));
    this.userMessage = userMessage;
  }

  get isValidation(): boolean {
    return this.code === 'VALIDATION_ERROR' && Array.isArray(this.details);
  }

  get isSessionExpired(): boolean {
    return this.code === 'TOKEN_EXPIRED' || this.code === 'INVALID_REFRESH_TOKEN';
  }
}

function resolveUserMessage(
  kind: ApiErrorKind,
  status: number | null,
  code: string | null,
  serverMessage: string | null
): string {
  if (kind === 'timeout') return 'The request timed out. Check your connection and try again.';
  if (kind === 'network') return GENERIC_SERVER_ERROR;
  if (kind === 'redirect') return 'The request was blocked for security reasons.';
  if (kind === 'parse') return GENERIC_SERVER_ERROR;

  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  if (status !== null && status >= 500) return GENERIC_SERVER_ERROR;
  if (serverMessage && status !== null && status >= 400 && status < 500) return serverMessage;
  if (status !== null && STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  return GENERIC_UNKNOWN;
}

interface ErrorEnvelopeShape {
  success?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    requestId?: unknown;
    details?: unknown;
  };
}

function parseDetails(raw: unknown): ApiFieldError[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const parsed: ApiFieldError[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const field = typeof rec.field === 'string' ? rec.field : 'root';
      const message = typeof rec.message === 'string' ? rec.message : 'Invalid value';
      const code = typeof rec.code === 'string' ? rec.code : undefined;
      parsed.push(code ? { field, code, message } : { field, message });
    }
  }
  return parsed.length > 0 ? parsed : null;
}

/**
 * Build an ApiError from a non-2xx response, understanding the backend's
 * uniform error envelope `{ success: false, error: { code, message, requestId, details? } }`.
 */
export function parseErrorResponse(
  status: number,
  body: unknown,
  fallbackRequestId: string | null
): ApiError {
  if (body && typeof body === 'object' && (body as ErrorEnvelopeShape).success === false) {
    const envelope = body as ErrorEnvelopeShape;
    const err = envelope.error;
    if (err && typeof err === 'object') {
      const code = typeof err.code === 'string' ? err.code : null;
      const message = typeof err.message === 'string' ? err.message : null;
      const requestId =
        typeof err.requestId === 'string' ? err.requestId : (fallbackRequestId ?? null);
      return new ApiError({
        kind: 'http',
        status,
        code,
        serverMessage: message,
        requestId,
        details: parseDetails(err.details)
      });
    }
  }
  return new ApiError({ kind: 'http', status, serverMessage: null, requestId: fallbackRequestId });
}

/** Normalize any thrown value into an ApiError without leaking internals. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError({ kind: 'network' });
}

/** Field-level messages for form binding (VALIDATION_ERROR only). */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (error instanceof ApiError && error.details) {
    const out: Record<string, string> = {};
    for (const detail of error.details) {
      if (!(detail.field in out)) out[detail.field] = detail.message;
    }
    return out;
  }
  return {};
}
