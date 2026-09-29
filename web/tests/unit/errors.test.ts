import { describe, expect, it } from 'vitest';
import { ApiError, fieldErrorsOf, parseErrorResponse, toApiError } from '@/lib/api/errors';

function jsonResponse(status: number, body: unknown, requestId?: string): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(requestId ? { 'X-Request-Id': requestId } : {})
    }
  });
}

describe('parseErrorResponse', () => {
  it('parses the verified error envelope', async () => {
    const res = jsonResponse(
      400,
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          requestId: 'req-42',
          details: [{ field: 'email', code: 'invalid_string', message: 'Invalid email' }]
        }
      },
      'req-42'
    );
    const error = parseErrorResponse(400, await res.json(), 'req-42');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('http');
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.requestId).toBe('req-42');
    expect(fieldErrorsOf(error)).toEqual({ email: 'Invalid email' });
  });

  it('never surfaces raw server text for 5xx — safe generic message only', async () => {
    const error = parseErrorResponse(
      500,
      'Error: SELECT failed at line 12 with password=hunter2',
      'req'
    );
    expect(error.userMessage).not.toContain('hunter2');
    expect(error.userMessage).not.toContain('SELECT');
    expect(error.userMessage).toMatch(
      /Unable to reach the server|temporarily unavailable|Something went wrong/i
    );
  });

  it('maps known 401 codes to safe canned messages', () => {
    const expired = parseErrorResponse(
      401,
      {
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'jwt expired at internal detail', requestId: 'r' }
      },
      'r'
    );
    expect(expired.code).toBe('TOKEN_EXPIRED');
    expect(expired.userMessage).not.toContain('jwt');
  });

  it('falls back safely when the body is not JSON', async () => {
    const error = parseErrorResponse(502, '<html><body>Bad gateway</body></html>', null);
    expect(error.kind).toBe('http');
    expect(error.userMessage).not.toContain('<html>');
  });

  it('keeps safe 4xx server messages when the code is unknown', () => {
    const error = parseErrorResponse(
      404,
      {
        success: false,
        error: { code: 'SOME_UNKNOWN_CODE', message: 'Task not found', requestId: 'r' }
      },
      'r'
    );
    expect(error.userMessage).toBe('Task not found');
    expect(error.code).toBe('SOME_UNKNOWN_CODE');
  });
});

describe('toApiError / fieldErrorsOf', () => {
  it('wraps unknown errors as non-leaky ApiError', () => {
    const error = toApiError(new Error('internal stack\n at /srv/app.js'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.userMessage).not.toContain('/srv/app.js');
  });

  it('returns empty field map for errors without details', () => {
    expect(fieldErrorsOf(new Error('x'))).toEqual({});
  });
});
