/**
 * src/features/auth/auth.repository.ts
 *
 * Implements Section 4.3 & 6.3: AuthRepository Interface.
 */

import type pg from 'pg';
import type { UserRow, AuthSession, RefreshTokenRow } from './auth.types.js';

export interface CreateUserData {
  email: string;
  passwordHash: string;
  displayName: string;
  timezone: string;
  locale: string;
  defaultCurrency: string;
}

export interface CreateSessionData {
  userId: string;
  absoluteExpiresAt: Date;
  devicePlatform: 'ios' | 'android' | 'unknown';
  deviceName?: string | undefined;
  appVersion?: string | undefined;
  createdIp?: string | undefined;
}

export interface CreateRefreshTokenData {
  sessionId: string;
  userId: string;
  tokenHash: Buffer;
  expiresAt: Date;
}

export interface TokenWithSessionAndUser {
  token: RefreshTokenRow;
  session: AuthSession;
  user: UserRow;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRow | null>;
  findUserById(id: string): Promise<UserRow | null>;
  createUser(data: CreateUserData, client?: pg.PoolClient): Promise<UserRow>;
  createDefaultCategories(userId: string, client?: pg.PoolClient): Promise<void>;
  createSession(data: CreateSessionData, client?: pg.PoolClient): Promise<AuthSession>;
  createRefreshToken(
    data: CreateRefreshTokenData,
    client?: pg.PoolClient
  ): Promise<RefreshTokenRow>;
  findRefreshTokenWithSession(tokenHash: Buffer): Promise<TokenWithSessionAndUser | null>;
  rotateRefreshToken(
    oldTokenId: string,
    newToken: CreateRefreshTokenData,
    client?: pg.PoolClient
  ): Promise<boolean>;
  revokeSession(sessionId: string, reason: string, client?: pg.PoolClient): Promise<void>;
  revokeAllUserSessions(
    userId: string,
    reason: string,
    exceptSessionId?: string,
    client?: pg.PoolClient
  ): Promise<void>;
  updateUserPassword(userId: string, passwordHash: string, client?: pg.PoolClient): Promise<void>;
  updateLastLogin(userId: string): Promise<void>;
  deleteSessionPushDevices(sessionId: string, client?: pg.PoolClient): Promise<void>;
  deleteAllUserPushDevices(
    userId: string,
    exceptSessionId?: string,
    client?: pg.PoolClient
  ): Promise<void>;
}
