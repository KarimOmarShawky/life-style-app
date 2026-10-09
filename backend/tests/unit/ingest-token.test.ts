/**
 * tests/unit/ingest-token.test.ts
 *
 * Validates the ingest token format and digest handling used by background SMS capture.
 */

import { describe, it, expect } from 'vitest';
import {
  INGEST_TOKEN_PREFIX,
  generateIngestToken,
  hashIngestToken,
  isIngestTokenFormat
} from '../../src/core/security/ingest-token.js';

describe('ingest tokens', () => {
  it('generates prefixed, URL-safe tokens that pass the format check', () => {
    const { token } = generateIngestToken();
    expect(token.startsWith(INGEST_TOKEN_PREFIX)).toBe(true);
    expect(token).toMatch(/^lsi_[A-Za-z0-9_-]{43}$/);
    expect(isIngestTokenFormat(token)).toBe(true);
  });

  it('keeps only a 32-byte SHA-256 digest, computed from the raw token', () => {
    const { token, tokenHash } = generateIngestToken();
    expect(tokenHash.length).toBe(32);
    expect(tokenHash.equals(hashIngestToken(token))).toBe(true);
    expect(hashIngestToken(`${token}x`).equals(tokenHash)).toBe(false);
  });

  it('does not repeat tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateIngestToken().token));
    expect(tokens.size).toBe(200);
  });

  it('rejects values that are not ingest tokens', () => {
    expect(isIngestTokenFormat('')).toBe(false);
    expect(isIngestTokenFormat('lsi_short')).toBe(false);
    expect(isIngestTokenFormat(`ing_${'a'.repeat(43)}`)).toBe(false);
    expect(isIngestTokenFormat(`lsi_${'a'.repeat(42)}!`)).toBe(false);
    expect(isIngestTokenFormat(`lsi_${'a'.repeat(44)}`)).toBe(false);
    // An access token (a JWT) must never pass for an ingest token.
    expect(isIngestTokenFormat('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl')).toBe(false);
  });
});
