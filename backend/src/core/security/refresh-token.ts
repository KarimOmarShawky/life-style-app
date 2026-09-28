/**
 * src/core/security/refresh-token.ts
 *
 * Implements Section 8.2.2 & ADR-002: Opaque Refresh Token Architecture.
 * Generates 256-bit base64url random tokens (43 characters) and computes SHA-256 hashes.
 */

import { randomBytes, createHash } from 'node:crypto';

export interface GeneratedRefreshToken {
  rawToken: string;
  tokenHash: Buffer;
}

export function generateRefreshToken(): GeneratedRefreshToken {
  const bytes = randomBytes(32);
  const rawToken = bytes.toString('base64url');
  const tokenHash = hashRefreshToken(rawToken);

  return {
    rawToken,
    tokenHash
  };
}

export function hashRefreshToken(rawToken: string): Buffer {
  return createHash('sha256').update(rawToken).digest();
}
