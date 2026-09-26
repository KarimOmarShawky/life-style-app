/**
 * Auth feature types.
 *
 * `UserRecord` mirrors the database row and is INTERNAL. It carries the password
 * hash and the lockout state, so it must never be returned from a controller.
 * `UserProfile` is the public projection; `auth.mapper.ts` is the only place
 * that converts one into the other (spec section 35).
 */
import type { UserRole } from '@/core/security/authenticated-user';

/** A row from `users`. Contains secrets. Never serialize this. */
export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string | null;
  readonly role: UserRole;
  readonly isActive: boolean;
  readonly failedLoginAttempts: number;
  readonly lockedUntil: Date | null;
  readonly passwordChangedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The client-safe projection of a user. */
export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: UserRole;
  readonly createdAt: string;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly tokenType: 'Bearer';
}

export interface AuthResult {
  readonly user: UserProfile;
  readonly tokens: AuthTokens;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string | undefined;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

/** Request context captured for the audit trail and session list. */
export interface RequestOrigin {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface StoredRefreshToken {
  readonly id: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: string | null;
}

export type RevocationReason =
  'rotated' | 'logout' | 'reuse_detected' | 'password_changed' | 'admin' | 'expired';
