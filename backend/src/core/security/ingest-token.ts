/**
 * src/core/security/ingest-token.ts
 *
 * Ingest tokens let the Android SMS receiver save wallet transactions while the app is closed.
 * A token is opaque, random (256 bits), and bound to one login session. Only its SHA-256 digest is
 * stored. The token is accepted by the ingest transaction route and by no other route.
 */

import { createHash, randomBytes } from 'node:crypto';

export const INGEST_TOKEN_PREFIX = 'lsi_';

// 32 random bytes encode to 43 base64url characters without padding.
const INGEST_TOKEN_PATTERN = /^lsi_[A-Za-z0-9_-]{43}$/;

export interface GeneratedIngestToken {
  token: string;
  tokenHash: Buffer;
}

export function generateIngestToken(): GeneratedIngestToken {
  const token = `${INGEST_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashIngestToken(token) };
}

export function hashIngestToken(rawToken: string): Buffer {
  return createHash('sha256').update(rawToken).digest();
}

export function isIngestTokenFormat(value: string): boolean {
  return INGEST_TOKEN_PATTERN.test(value);
}
