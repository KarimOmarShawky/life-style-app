/**
 * Response mapping (spec section 35).
 *
 * The rule this file enforces: a database record never reaches the network. Each
 * mapper names every field it emits, so adding a column to `users` cannot
 * accidentally publish it. That is why these are explicit constructions rather
 * than a spread with deletions, which fails open when a new sensitive column
 * appears.
 */
import type { AuthResult, AuthTokens, UserProfile, UserRecord } from './auth.types';

export function toUserProfile(record: UserRecord): UserProfile {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    role: record.role,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toAuthResult(record: UserRecord, tokens: AuthTokens): AuthResult {
  return { user: toUserProfile(record), tokens };
}
