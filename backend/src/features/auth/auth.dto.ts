/**
 * src/features/auth/auth.dto.ts
 *
 * Implements Section 14.3: User DTO Mapper.
 * Explicitly maps database rows to client responses, completely stripping password_hash and internal fields.
 */

import type { UserRow, UserDto, TokensDto } from './auth.types.js';

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    timezone: row.timezone,
    locale: row.locale,
    weekStart: row.week_start,
    defaultCurrency: row.default_currency,
    pushShowTitles: row.push_show_titles,
    status: row.status,
    emailVerified: Boolean(row.email_verified_at),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString()
  };
}

export function formatTokensDto(options: {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}): TokensDto {
  return {
    accessToken: options.accessToken,
    accessTokenExpiresAt: options.accessTokenExpiresAt.toISOString(),
    refreshToken: options.refreshToken,
    refreshTokenExpiresAt: options.refreshTokenExpiresAt.toISOString()
  };
}
