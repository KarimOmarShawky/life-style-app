/**
 * tests/unit/app-error.test.ts
 *
 * Verifies Section 15.2 & 15.4: AppError factories, status codes, and error code catalogue.
 */

import { describe, it, expect } from 'vitest';
import { AppError } from '../../src/core/errors/app-error.js';

describe('AppError Architecture (Spec §15.2, §15.4)', () => {
  it('creates validation error with field details', () => {
    const error = AppError.validation([
      { field: 'dueTime', code: 'REQUIRES_DUE_DATE', message: 'dueTime requires dueDate' }
    ]);

    expect(error.httpStatus).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.safeMessage).toBe('Validation failed');
    expect(error.isOperational).toBe(true);
    expect(error.details).toHaveLength(1);
    expect(error.details?.[0]?.field).toBe('dueTime');
  });

  it('creates unauthenticated error', () => {
    const error = AppError.unauthenticated();
    expect(error.httpStatus).toBe(401);
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.safeMessage).toBe('Authentication required');
    expect(error.isOperational).toBe(true);
  });

  it('creates forbidden error', () => {
    const error = AppError.forbidden();
    expect(error.httpStatus).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('creates notFound error', () => {
    const error = AppError.notFound('Task not found');
    expect(error.httpStatus).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.safeMessage).toBe('Task not found');
  });

  it('creates conflict error with specific business code', () => {
    const error = AppError.conflict('EMAIL_ALREADY_REGISTERED', 'Email already in use');
    expect(error.httpStatus).toBe(409);
    expect(error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('creates rateLimited error with retry-after metadata', () => {
    const error = AppError.rateLimited(45);
    expect(error.httpStatus).toBe(429);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.meta?.retryAfterSeconds).toBe(45);
  });

  it('creates payloadTooLarge error', () => {
    const error = AppError.payloadTooLarge();
    expect(error.httpStatus).toBe(413);
    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('creates unsupportedMediaType error', () => {
    const error = AppError.unsupportedMediaType();
    expect(error.httpStatus).toBe(415);
    expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('creates serviceUnavailable error', () => {
    const error = AppError.serviceUnavailable();
    expect(error.httpStatus).toBe(503);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
