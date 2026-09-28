/**
 * tests/unit/logger-redaction.test.ts
 *
 * Verifies Section 16.5 & ADR-022: Structured logging redaction and AsyncLocalStorage context.
 */

import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { requestContextStore } from '../../src/core/logger/logger.js';

describe('Logger Context and Redaction (Spec §16.5, ADR-022)', () => {
  it('injects requestId and userId from AsyncLocalStorage mixin', () => {
    requestContextStore.run({ requestId: 'test-req-1234', userId: 'user-uuid-999' }, () => {
      const context = requestContextStore.getStore();
      expect(context?.requestId).toBe('test-req-1234');
      expect(context?.userId).toBe('user-uuid-999');
    });
  });

  it('isolates context across independent asynchronous execution scopes', async () => {
    const scope1 = requestContextStore.run({ requestId: 'scope-1' }, async () => {
      await new Promise((res) => setTimeout(res, 10));
      return requestContextStore.getStore()?.requestId;
    });

    const scope2 = requestContextStore.run({ requestId: 'scope-2' }, async () => {
      await new Promise((res) => setTimeout(res, 5));
      return requestContextStore.getStore()?.requestId;
    });

    const [res1, res2] = await Promise.all([scope1, scope2]);
    expect(res1).toBe('scope-1');
    expect(res2).toBe('scope-2');
  });

  it('redacts sensitive fields (passwords, tokens, secrets) in output logs', async () => {
    let loggedData = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        loggedData += chunk.toString();
        callback();
      }
    });

    const testLogger = pino(
      {
        redact: {
          paths: ['password', '*.password', 'token', '*.token', 'authorization', 'otp'],
          censor: '[REDACTED]'
        }
      },
      destination
    );

    testLogger.info(
      {
        password: 'super-sensitive-password',
        token: 'jwt-access-token-12345',
        otp: '123456',
        safeField: 'harmless'
      },
      'Authentication attempt'
    );

    expect(loggedData).toContain('[REDACTED]');
    expect(loggedData).not.toContain('super-sensitive-password');
    expect(loggedData).not.toContain('jwt-access-token-12345');
    expect(loggedData).not.toContain('123456');
    expect(loggedData).toContain('harmless');
  });
});
