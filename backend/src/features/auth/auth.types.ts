/**
 * src/features/auth/auth.types.ts
 *
 * Implements Section 6.3 & 14.2: Domain types for authentication and identity.
 */

export interface User {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  locale: string;
  weekStart: number;
  defaultCurrency: string;
  status: 'active' | 'disabled' | 'pending_deletion';
  emailVerified: boolean;
  passwordChangedAt: Date;
  lastLoginAt: Date | null;
  deletionScheduledFor: Date | null;
  pushShowTitles: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  timezone: string;
  locale: string;
  week_start: number;
  default_currency: string;
  status: 'active' | 'disabled' | 'pending_deletion';
  email_verified_at: Date | null;
  password_changed_at: Date;
  last_login_at: Date | null;
  deletion_scheduled_for: Date | null;
  push_show_titles: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AuthSession {
  id: string;
  userId: string;
  createdAt: Date;
  lastUsedAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  devicePlatform: 'ios' | 'android' | 'unknown';
  deviceName: string | null;
  appVersion: string | null;
  createdIp: string | null;
}

export interface RefreshTokenRow {
  id: string;
  session_id: string;
  user_id: string;
  token_hash: Buffer;
  issued_at: Date;
  expires_at: Date;
  rotated_at: Date | null;
  replaced_by: string | null;
  revoked_at: Date | null;
}

export interface TokensDto {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  locale: string;
  weekStart: number;
  defaultCurrency: string;
  pushShowTitles: boolean;
  status: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthResponseDto {
  user: UserDto;
  tokens: TokensDto;
}
