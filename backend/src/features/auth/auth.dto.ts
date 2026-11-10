/**
 * src/features/auth/auth.dto.ts
 *
 * Implements Section 14.3: User DTO Mapper.
 * Explicitly maps database rows to client responses, completely stripping password_hash and internal fields.
 */

import type { UserRow, UserDto, TokensDto } from './auth.types.js';

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toUserDto(row: UserRow): UserDto {
  const dto: UserDto = {
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
    createdAt: toIso(row.created_at)
  };
  // Capability-gated fields (G5/G1): a database that has not received
  // migration 1792750000000 has no such columns, and clients treat an absent
  // field as "feature unavailable" (no onboarding prompt, no events).
  if (row.product_events_enabled !== undefined) {
    dto.productEventsEnabled = row.product_events_enabled;
  }
  if (row.onboarding_completed_at !== undefined) {
    dto.onboardingCompletedAt =
      row.onboarding_completed_at === null ? null : toIso(row.onboarding_completed_at);
  }
  return dto;
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
