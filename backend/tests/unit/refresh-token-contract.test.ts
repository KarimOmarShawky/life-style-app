import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashRefreshToken } from '../../src/core/security/refresh-token.js';
import { refreshSchema } from '../../src/features/auth/auth.validation.js';

describe('generated refresh token format', () => {
  it('produces a URL-safe string encoding 32 bytes', () => {
    const { rawToken } = generateRefreshToken();

    expect(typeof rawToken).toBe('string');
    expect(/^[A-Za-z0-9_-]{43}$/.test(rawToken)).toBe(true);
    expect(Buffer.from(rawToken, 'base64url').length).toBe(32);
  });
});

describe('refresh token hashing contract', () => {
  it('hashes the encoded token string with SHA-256', () => {
    const { rawToken, tokenHash } = generateRefreshToken();
    const expected = createHash('sha256').update(rawToken, 'utf8').digest();

    expect(tokenHash.length).toBe(32);
    expect(hashRefreshToken(rawToken).equals(expected)).toBe(true);
    expect(tokenHash.equals(expected)).toBe(true);
  });
});

describe('stable known input', () => {
  it('matches the independently computed SHA-256 digest', () => {
    const syntheticToken = 'A'.repeat(43);
    const expectedHex = '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a';

    expect(hashRefreshToken(syntheticToken).toString('hex')).toBe(expectedHex);
    expect(hashRefreshToken(syntheticToken).toString('hex')).toBe(expectedHex);
  });
});

describe('refresh request validation', () => {
  it('accepts a generated token', () => {
    const { rawToken } = generateRefreshToken();
    expect(refreshSchema.safeParse({ refreshToken: rawToken }).success).toBe(true);
  });

  it('rejects wrong lengths', () => {
    for (const length of [0, 42, 44]) {
      expect(refreshSchema.safeParse({ refreshToken: 'A'.repeat(length) }).success).toBe(false);
    }
  });

  it('rejects invalid characters', () => {
    for (const character of ['+', '/', '=', ' ']) {
      expect(refreshSchema.safeParse({ refreshToken: 'A'.repeat(42) + character }).success).toBe(false);
    }
  });

  it('rejects unexpected fields', () => {
    const { rawToken } = generateRefreshToken();
    expect(refreshSchema.safeParse({ refreshToken: rawToken, extra: true }).success).toBe(false);
  });
});
