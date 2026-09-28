/**
 * src/core/http/envelope.ts
 *
 * Implements Section 15.1: Response Envelope Contract.
 * Enforces uniform JSON response formats for single items, paginated collections, and errors.
 */

import type { FieldError } from '../errors/app-error.js';

export interface PageMeta {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: PageMeta | undefined;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  requestId: string;
  details?: FieldError[] | undefined;
}

export interface ApiErrorEnvelope {
  success: false;
  error: ApiErrorPayload;
}

export type ApiResponse<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

/**
 * Wraps payload into standard success response envelope.
 */
export function successResponse<T>(data: T, meta?: PageMeta): ApiSuccessEnvelope<T> {
  if (meta) {
    return {
      success: true,
      data,
      meta
    };
  }
  return {
    success: true,
    data
  };
}

/**
 * Wraps error details into standard error response envelope.
 */
export function errorResponse(options: {
  code: string;
  message: string;
  requestId: string;
  details?: FieldError[] | undefined;
}): ApiErrorEnvelope {
  const payload: ApiErrorPayload = {
    code: options.code,
    message: options.message,
    requestId: options.requestId
  };

  if (options.details && options.details.length > 0) {
    payload.details = options.details;
  }

  return {
    success: false,
    error: payload
  };
}
