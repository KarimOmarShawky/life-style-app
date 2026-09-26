/**
 * Unit tests for the error contract (spec sections 24, 25, 41).
 *
 * The critical property under test: internal detail must not survive
 * serialization to the client.
 */
import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';

import { AppError, ErrorCode } from '@/core/errors';
import { normalizeError } from '@/core/errors/normalize';

describe('AppError', () => {
  it('keeps metadata and cause out of the client payload', () => {
    const error = new AppError(ErrorCode.DATABASE_ERROR, {
      metadata: {
        connectionString: 'postgres://user:hunter2@db/app',
        constraint: 'users_email_key',
      },
      cause: new Error('duplicate key value violates unique constraint'),
    });

    const serialized = JSON.stringify(error.toClientJSON('req-1'));

    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('users_email_key');
    expect(serialized).not.toContain('duplicate key');
    expect(serialized).toContain('DATABASE_ERROR');
  });

  it('carries the request id so a user can quote it', () => {
    const body = AppError.notFound('Task').toClientJSON('req-42');
    expect(body.error.requestId).toBe('req-42');
    expect(body.success).toBe(false);
  });

  it('uses NOT_FOUND for ownership failures so ids cannot be enumerated', () => {
    // A 403 on someone else's row and a 404 on a missing one would let an
    // attacker distinguish real ids from fake ones.
    const error = AppError.notFound('Task', { attemptedBy: 'a', ownedBy: 'b' });
    expect(error.status).toBe(404);
    expect(JSON.stringify(error.toClientJSON())).not.toContain('ownedBy');
  });

  it('marks unexpected failures as non-operational', () => {
    expect(AppError.internal(new Error('boom')).isOperational).toBe(false);
    expect(AppError.notFound().isOperational).toBe(true);
  });
});

describe('normalizeError', () => {
  it('turns a Zod failure into field-level issues', () => {
    const schema = z.object({ email: z.string().email(), age: z.number().min(18) });
    const result = schema.safeParse({ email: 'nope', age: 5 });

    const error = normalizeError(result.success ? new Error('unreachable') : result.error);

    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.issues.map((i) => i.field)).toEqual(['email', 'age']);
  });

  it('maps a Postgres unique violation without naming the column', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'users_email_key',
      table: 'users',
    });

    const error = normalizeError(pgError);

    expect(error.code).toBe(ErrorCode.ALREADY_EXISTS);
    expect(error.status).toBe(409);
    // The constraint name is kept for the log but not for the client.
    expect(error.metadata['constraint']).toBe('users_email_key');
    expect(JSON.stringify(error.toClientJSON())).not.toContain('users_email_key');
  });

  it('maps a serialization failure to a retryable conflict', () => {
    const pgError = Object.assign(new Error('could not serialize access'), { code: '40001' });
    const error = normalizeError(pgError);

    expect(error.code).toBe(ErrorCode.CONFLICT);
    expect(error.retryAfterSeconds).toBe(1);
  });

  it('fails closed on an unrecognized error', () => {
    const error = normalizeError(new Error('something nobody anticipated'));
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.status).toBe(500);
    expect(error.isOperational).toBe(false);
  });

  it('does not echo a thrown non-Error value', () => {
    // A thrown string could itself be sensitive, so only its type is recorded.
    const error = normalizeError('postgres://user:hunter2@db/app');
    expect(JSON.stringify(error.metadata)).not.toContain('hunter2');
    expect(error.metadata['thrownType']).toBe('string');
  });

  it('passes an existing AppError through unchanged', () => {
    const original = AppError.rateLimited(30);
    expect(normalizeError(original)).toBe(original);
  });

  it('handles a Zod error nested in an array path', () => {
    const schema = z.object({ tags: z.array(z.string().min(2)) });
    const result = schema.safeParse({ tags: ['ok', 'x'] });
    const error = normalizeError(result.success ? new ZodError([]) : result.error);

    expect(error.issues[0]?.field).toBe('tags[1]');
  });
});
