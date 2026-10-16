import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, requestContextStore } from '../../src/core/logger/logger.js';

function capture() {
  let output = '';
  const log = createLogger(
    new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      }
    })
  );
  log.level = 'info';
  return {
    log,
    entries: () =>
      output
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s))
  };
}

describe('Production logger policy', () => {
  it('injects the actual async request context into output', () => {
    const { log, entries } = capture();
    requestContextStore.run({ requestId: 'request-1', userId: 'user-1' }, () => log.info('safe'));
    log.info('outside request');
    expect(entries()[0]).toMatchObject({ requestId: 'request-1', userId: 'user-1', msg: 'safe' });
    expect(entries()[1]).not.toHaveProperty('requestId');
    expect(entries()[1]).not.toHaveProperty('userId');
  });

  it('isolates real logger output across concurrent async scopes', async () => {
    const { log, entries } = capture();
    await Promise.all(
      ['scope-1', 'scope-2'].map((requestId) =>
        requestContextStore.run({ requestId }, async () => {
          await Promise.resolve();
          log.info({ scope: requestId }, 'scoped');
        })
      )
    );
    for (const entry of entries()) expect(entry.requestId).toBe(entry.scope);
    expect(entries()).toHaveLength(2);
  });

  it('redacts actual credentials at all supported structured depths without mutating input', () => {
    const { log, entries } = capture();
    const payload = {
      password: 'top-secret',
      proof: { currentPassword: 'current-secret', newPassword: 'new-secret' },
      response: { tokens: { refreshToken: 'refresh-secret', accessToken: 'access-secret' } },
      req: {
        headers: {
          authorization: 'bearer-secret',
          cookie: 'cookie-secret',
          'x-goog-api-key': 'api-secret'
        }
      },
      headers: { 'set-cookie': 'set-cookie-secret' },
      credential: { password_hash: 'hash-secret', otp: 'otp-secret', ingestToken: 'ingest-secret' },
      safeField: 'safe-value'
    };
    const original = JSON.stringify(payload);
    log.info(payload, 'credential check');
    const output = JSON.stringify(entries());
    for (const value of [
      'top',
      'current',
      'new',
      'refresh',
      'access',
      'bearer',
      'cookie',
      'api',
      'set-cookie',
      'hash',
      'otp',
      'ingest'
    ]) {
      expect(output).not.toContain(`${value}-secret`);
    }
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('safe-value');
    expect(JSON.stringify(payload)).toBe(original);
  });

  it('suppresses complete HTTP bodies, including arbitrary-depth financial/private contents', () => {
    const { log, entries } = capture();
    log.info(
      {
        req: { body: { arbitrary: { deeply: { nested: ['private-content'] } } } },
        request: { body: 'private-request' },
        res: { body: { transactions: ['private-finance'] } },
        response: { body: 'private-response' }
      },
      'HTTP metadata'
    );
    expect(entries()[0]).toMatchObject({
      req: { body: '[REDACTED]' },
      request: { body: '[REDACTED]' },
      res: { body: '[REDACTED]' },
      response: { body: '[REDACTED]' }
    });
    expect(JSON.stringify(entries())).not.toContain('private-');
  });
});
