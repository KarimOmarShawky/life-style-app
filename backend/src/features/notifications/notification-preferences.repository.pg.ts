/**
 * src/features/notifications/notification-preferences.repository.pg.ts
 *
 * Feature guide G2 (ADR-046). Until the owner-run SQL creates the table, every
 * method reports `available: false` instead of failing, so the API and the
 * worker keep working with the defaults.
 */

import type pg from 'pg';
import { logger } from '../../core/logger/logger.js';
import { isMissingSchemaObject } from '../../infrastructure/database/postgres/schema-capabilities.js';
import type { NotificationPreferences } from './notification-policy.js';

export type StoredPreferences =
  { available: false } | { available: true; preferences: NotificationPreferences | null };

export interface NotificationPreferencesStore {
  /** The account's row, or null when it never saved settings. */
  find(userId: string): Promise<StoredPreferences>;
  /** Upserts the full settings of an active account. False when no active account matched. */
  save(
    userId: string,
    preferences: NotificationPreferences
  ): Promise<{ available: false } | { available: true; saved: boolean }>;
}

interface PreferencesRow {
  notifications_enabled: boolean;
  quiet_start_minute: number | null;
  quiet_end_minute: number | null;
  daily_cap: number | null;
  digest_enabled: boolean;
  critical_breaks_quiet: boolean;
}

export const PREFERENCE_COLUMNS =
  'notifications_enabled, quiet_start_minute, quiet_end_minute, daily_cap, digest_enabled, critical_breaks_quiet';

export function preferencesFromRow(row: PreferencesRow): NotificationPreferences {
  return {
    notificationsEnabled: row.notifications_enabled,
    quietStartMinute: row.quiet_start_minute,
    quietEndMinute: row.quiet_end_minute,
    dailyCap: row.daily_cap,
    digestEnabled: row.digest_enabled,
    criticalBreaksQuiet: row.critical_breaks_quiet
  };
}

let warnedUnavailable = false;

export function noteNotificationPreferencesUnavailable(): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  // No user data: only the fact that the owner-run DDL is still pending.
  logger.warn('Notification preferences schema is not applied yet; defaults are used');
}

export class PgNotificationPreferencesRepository implements NotificationPreferencesStore {
  constructor(private readonly pool: Pick<pg.Pool, 'query'>) {}

  public async find(userId: string): Promise<StoredPreferences> {
    try {
      const res = await this.pool.query<PreferencesRow>(
        `SELECT ${PREFERENCE_COLUMNS} FROM notification_preferences WHERE user_id = $1`,
        [userId]
      );
      const row = res.rows[0];
      return { available: true, preferences: row ? preferencesFromRow(row) : null };
    } catch (err) {
      if (isMissingSchemaObject(err)) {
        noteNotificationPreferencesUnavailable();
        return { available: false };
      }
      throw err;
    }
  }

  public async save(
    userId: string,
    preferences: NotificationPreferences
  ): Promise<{ available: false } | { available: true; saved: boolean }> {
    try {
      // Only an active account can write; the account check and the upsert
      // are one statement, so a concurrent deletion cannot be undone here.
      const res = await this.pool.query(
        `INSERT INTO notification_preferences (user_id, ${PREFERENCE_COLUMNS})
         SELECT u.id, $2, $3, $4, $5, $6, $7
         FROM users u
         WHERE u.id = $1 AND u.status = 'active'
         ON CONFLICT (user_id) DO UPDATE SET
           notifications_enabled = EXCLUDED.notifications_enabled,
           quiet_start_minute = EXCLUDED.quiet_start_minute,
           quiet_end_minute = EXCLUDED.quiet_end_minute,
           daily_cap = EXCLUDED.daily_cap,
           digest_enabled = EXCLUDED.digest_enabled,
           critical_breaks_quiet = EXCLUDED.critical_breaks_quiet,
           updated_at = now()
         RETURNING user_id`,
        [
          userId,
          preferences.notificationsEnabled,
          preferences.quietStartMinute,
          preferences.quietEndMinute,
          preferences.dailyCap,
          preferences.digestEnabled,
          preferences.criticalBreaksQuiet
        ]
      );
      return { available: true, saved: (res.rowCount ?? 0) > 0 };
    } catch (err) {
      if (isMissingSchemaObject(err)) {
        noteNotificationPreferencesUnavailable();
        return { available: false };
      }
      throw err;
    }
  }
}

/** Test hook: reset the one-time warning latch. */
export function resetNotificationPreferencesWarningForTests(): void {
  warnedUnavailable = false;
}
