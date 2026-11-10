import { streamAccountArchive } from './account-archive.js';
/**
 * src/features/users/users.repository.pg.ts
 *
 * Implements Section 14.3: PostgreSQL Implementation of UsersRepository.
 */

import type pg from 'pg';
import type { UsersRepository, PurgeAccountOptions } from './users.repository.js';
import type { UserRow } from '../auth/auth.types.js';
import type {
  UpdateUserProfileInput,
  RegisterPushDeviceInput,
  UserExportData
} from './users.types.js';
import { AppError } from '../../core/errors/app-error.js';
import {
  isMissingSchemaObject,
  tableExists
} from '../../infrastructure/database/postgres/schema-capabilities.js';

/**
 * Child tables owned by a user, ordered so foreign-key children (including
 * `transactions`, `subscriptions`, and `budgets` which have `ON DELETE RESTRICT`
 * foreign keys to `categories`) are deleted before their parent rows.
 */
export const LEGACY_METADATA_ROW_LIMIT = 1000;

/**
 * Product events are bounded by one row per event per local day (six event
 * names) and a 400-day retention purge, so 5000 rows can only be exceeded by
 * misuse; overflow returns 413 instead of silent truncation.
 */
export const PRODUCT_EVENTS_EXPORT_LIMIT = 5000;

/**
 * Owned tables created by additive DDL that the owner-managed production
 * database receives out of band. Purge skips such a table only while it does
 * not exist (it then cannot hold rows); every other owned table is mandatory
 * and a missing one still fails the purge closed.
 */
export const OPTIONAL_USER_OWNED_TABLES: ReadonlySet<string> = new Set(['product_events']);

export const USER_OWNED_TABLES_IN_DELETE_ORDER = [
  // Accepted password-reset metadata is user-owned security data: it must not
  // outlive the account (V-06). It has no incoming FKs, so it is safe first.
  'password_reset_requests',
  // Content-free usage events (G5). Leaf table; also ON DELETE CASCADE.
  'product_events',
  'ingest_tokens',
  'push_devices',
  'reminders',
  'note_links',
  'timer_sessions',
  'habit_checkins',
  'recurrences',
  'tasks',
  'recurring_tasks',
  'habits',
  'milestones',
  'projects',
  'goals',
  'notes',
  'events',
  'transactions',
  'subscriptions',
  'budgets',
  'categories'
] as const;

export class PgUsersRepository implements UsersRepository {
  constructor(private readonly pool: pg.Pool) {}

  public streamUserArchive(userId: string, signal: AbortSignal) {
    return streamAccountArchive(this.pool, userId, signal);
  }

  public async getUserProfile(userId: string): Promise<UserRow | null> {
    const res = await this.pool.query<UserRow>(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [
      userId
    ]);
    return res.rows[0] ?? null;
  }

  public async updateUserProfile(
    userId: string,
    updates: UpdateUserProfileInput
  ): Promise<UserRow> {
    const setClauses: string[] = ['updated_at = now()'];
    const values: (string | number | boolean)[] = [userId];
    let paramIdx = 2;

    if (updates.displayName !== undefined) {
      setClauses.push(`display_name = $${paramIdx++}`);
      values.push(updates.displayName);
    }
    if (updates.timezone !== undefined) {
      setClauses.push(`timezone = $${paramIdx++}`);
      values.push(updates.timezone);
    }
    if (updates.locale !== undefined) {
      setClauses.push(`locale = $${paramIdx++}`);
      values.push(updates.locale);
    }
    if (updates.weekStart !== undefined) {
      setClauses.push(`week_start = $${paramIdx++}`);
      values.push(updates.weekStart);
    }
    if (updates.defaultCurrency !== undefined) {
      setClauses.push(`default_currency = $${paramIdx++}`);
      values.push(updates.defaultCurrency);
    }
    if (updates.pushShowTitles !== undefined) {
      setClauses.push(`push_show_titles = $${paramIdx++}`);
      values.push(updates.pushShowTitles);
    }
    if (updates.productEventsEnabled !== undefined) {
      setClauses.push(`product_events_enabled = $${paramIdx++}`);
      values.push(updates.productEventsEnabled);
    }
    if (updates.onboardingCompleted === true) {
      // Idempotent: the first completion/skip time is kept.
      setClauses.push('onboarding_completed_at = COALESCE(onboarding_completed_at, now())');
    }

    const query = `
      UPDATE users 
      SET ${setClauses.join(', ')} 
      WHERE id = $1 
      RETURNING *
    `;

    try {
      if (updates.productEventsEnabled !== false) {
        const res = await this.pool.query<UserRow>(query, values);
        return res.rows[0]!;
      }
      // Opting out also erases what was already recorded, atomically with the
      // preference change (G5: opt-out must not leave data behind).
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query<UserRow>(query, values);
        await client.query('DELETE FROM product_events WHERE user_id = $1', [userId]);
        await client.query('COMMIT');
        return res.rows[0]!;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      if (
        isMissingSchemaObject(err) &&
        (updates.productEventsEnabled !== undefined || updates.onboardingCompleted !== undefined)
      ) {
        throw AppError.serviceUnavailable('This setting is not available on the server yet');
      }
      throw err;
    }
  }

  public async upsertPushDevice(
    userId: string,
    sessionId: string,
    input: RegisterPushDeviceInput
  ): Promise<void> {
    const query = `
      INSERT INTO push_devices (
        user_id, session_id, platform, push_token, app_version, last_seen_at, disabled_at
      ) VALUES ($1, $2, $3, $4, $5, now(), NULL)
      ON CONFLICT (push_token) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        session_id = EXCLUDED.session_id,
        platform = EXCLUDED.platform,
        app_version = EXCLUDED.app_version,
        last_seen_at = now(),
        disabled_at = NULL
    `;
    await this.pool.query(query, [
      userId,
      sessionId,
      input.platform,
      input.pushToken,
      input.appVersion ?? null
    ]);
  }

  public async deletePushDevice(userId: string, deviceId: string): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM push_devices WHERE id = $1 AND user_id = $2`, [
      deviceId,
      userId
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  public async scheduleDeletion(
    userId: string,
    scheduledFor: Date,
    currentSessionId?: string
  ): Promise<Date> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingRes = await client.query<{
        status: 'active' | 'disabled' | 'pending_deletion';
        deletion_scheduled_for: Date | null;
      }>(`SELECT status, deletion_scheduled_for FROM users WHERE id = $1 FOR UPDATE`, [userId]);

      const existing = existingRes.rows[0];
      if (!existing) {
        throw AppError.notFound('User not found');
      }

      let effectiveDate = scheduledFor;
      if (existing.status === 'pending_deletion' && existing.deletion_scheduled_for !== null) {
        effectiveDate = new Date(existing.deletion_scheduled_for);
      } else {
        await client.query(
          `UPDATE users 
           SET status = 'pending_deletion', deletion_scheduled_for = $1, updated_at = now() 
           WHERE id = $2`,
          [scheduledFor, userId]
        );
      }

      // Immediately revoke headless ingest tokens, remove push devices, and cancel pending reminders.
      await client.query(
        `UPDATE ingest_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
      );
      await client.query(`DELETE FROM push_devices WHERE user_id = $1`, [userId]);
      await client.query(
        `UPDATE reminders
         SET status = 'cancelled', next_attempt_at = NULL, updated_at = now()
         WHERE user_id = $1 AND status IN ('pending', 'processing')`,
        [userId]
      );

      // Revoke all other sessions and refresh tokens while keeping the current session
      // able to call the grace-period exempt endpoints (/users/me, /users/me/export,
      // /users/me/deletion, /auth/logout, /auth/refresh) per AC-AUTH-10.
      if (currentSessionId) {
        await client.query(
          `UPDATE auth_sessions
           SET revoked_at = now(), revoked_reason = 'account_deletion'
           WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
          [userId, currentSessionId]
        );
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = now()
           WHERE user_id = $1 AND session_id <> $2 AND revoked_at IS NULL`,
          [userId, currentSessionId]
        );
      } else {
        await client.query(
          `UPDATE auth_sessions
           SET revoked_at = now(), revoked_reason = 'account_deletion'
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId]
        );
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId]
        );
      }

      await client.query('COMMIT');
      return effectiveDate;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async cancelDeletion(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE users 
       SET status = 'active', deletion_scheduled_for = NULL, updated_at = now() 
       WHERE id = $1`,
      [userId]
    );
  }

  public async purgeAccount(userId: string, options?: PurgeAccountOptions): Promise<boolean> {
    const requirePendingDeletion = options?.requirePendingDeletion ?? true;
    const cutoff = options?.cutoff;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query<{
        id: string;
        email: string;
        status: 'active' | 'disabled' | 'pending_deletion';
        deletion_scheduled_for: Date | null;
      }>(`SELECT id, email, status, deletion_scheduled_for FROM users WHERE id = $1 FOR UPDATE`, [
        userId
      ]);

      const user = userRes.rows[0];
      if (!user) {
        await client.query('COMMIT');
        return false;
      }

      if (requirePendingDeletion) {
        if (user.status !== 'pending_deletion' || user.deletion_scheduled_for === null) {
          await client.query('COMMIT');
          return false;
        }
        if (cutoff && new Date(user.deletion_scheduled_for).getTime() > cutoff.getTime()) {
          await client.query('COMMIT');
          return false;
        }
      }

      // 1. Revoke and delete authentication/session state (clearing self-referential replaced_by first).
      await client.query(
        `UPDATE ingest_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
      );
      await client.query(
        `UPDATE refresh_tokens SET replaced_by = NULL WHERE user_id = $1 AND replaced_by IS NOT NULL`,
        [userId]
      );
      await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);

      // 2. Delete all user-owned domain records in FK-safe order (transactions, subscriptions,
      // and budgets before categories to satisfy ON DELETE RESTRICT on categories).
      const absentOptional = new Set<string>();
      for (const table of OPTIONAL_USER_OWNED_TABLES) {
        if (!(await tableExists(client, table))) absentOptional.add(table);
      }
      for (const table of USER_OWNED_TABLES_IN_DELETE_ORDER) {
        if (absentOptional.has(table)) continue;
        await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
      }

      // 2b. Reset metadata recorded before the account link existed (or for a
      // request made while the account was in flight) has no user_id, so it is
      // erased by the account's email address instead (V-06).
      await client.query(`DELETE FROM password_reset_requests WHERE user_id = $1 OR email = $2`, [
        userId,
        user.email
      ]);

      // 3. Delete the user row (audit_logs.actor_user_id is ON DELETE SET NULL).
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async purgeExpiredAccounts(cutoff: Date): Promise<number> {
    const dueRes = await this.pool.query<{ id: string }>(
      `SELECT id
       FROM users
       WHERE status = 'pending_deletion'
         AND deletion_scheduled_for IS NOT NULL
         AND deletion_scheduled_for <= $1
       ORDER BY deletion_scheduled_for ASC`,
      [cutoff]
    );

    let purgedCount = 0;
    for (const row of dueRes.rows) {
      const purged = await this.purgeAccount(row.id, {
        requirePendingDeletion: true,
        cutoff
      });
      if (purged) {
        purgedCount += 1;
      }
    }
    return purgedCount;
  }

  public async getUserExportData(userId: string): Promise<UserExportData> {
    // This legacy endpoint exports account metadata only, not all domain data.
    // Never fetch authentication hashes just to discard them in serialization.
    type ExportProfile = Pick<
      UserRow,
      | 'id'
      | 'email'
      | 'display_name'
      | 'timezone'
      | 'locale'
      | 'week_start'
      | 'default_currency'
      | 'status'
      | 'created_at'
    >;
    const userRes = await this.pool.query<ExportProfile>(
      `SELECT id, email, display_name, timezone, locale, week_start,
              default_currency, status, created_at FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const user = userRes.rows[0];
    if (!user) throw AppError.notFound('User not found');

    const sessionsRes = await this.pool.query(
      `SELECT id, device_platform, device_name, app_version, created_at, last_used_at 
       FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT ${LEGACY_METADATA_ROW_LIMIT + 1}`,
      [userId]
    );

    const pushRes = await this.pool.query(
      `SELECT platform, last_seen_at, created_at FROM push_devices WHERE user_id = $1 ORDER BY id LIMIT ${LEGACY_METADATA_ROW_LIMIT + 1}`,
      [userId]
    );

    if ([sessionsRes, pushRes].some((result) => result.rows.length > LEGACY_METADATA_ROW_LIMIT)) {
      throw AppError.payloadTooLarge(
        'Metadata export exceeds its limit; use the domain archive endpoint'
      );
    }

    // G5/G1 settings and content-free product events. Until the owner applies
    // the product-events DDL these objects are absent: export what exists.
    let settings:
      { product_events_enabled: boolean; onboarding_completed_at: Date | null } | undefined;
    try {
      const settingsRes = await this.pool.query<{
        product_events_enabled: boolean;
        onboarding_completed_at: Date | null;
      }>(`SELECT product_events_enabled, onboarding_completed_at FROM users WHERE id = $1`, [
        userId
      ]);
      settings = settingsRes.rows[0];
    } catch (err) {
      if (!isMissingSchemaObject(err)) throw err;
    }
    let productEvents: UserExportData['productEvents'] = [];
    try {
      const eventsRes = await this.pool.query<{
        event_name: string;
        occurred_at: Date;
        occurred_on: string;
        platform: string;
        app_version: string | null;
      }>(
        `SELECT event_name, occurred_at, occurred_on, platform, app_version
         FROM product_events WHERE user_id = $1
         ORDER BY occurred_at, event_name LIMIT ${PRODUCT_EVENTS_EXPORT_LIMIT + 1}`,
        [userId]
      );
      if (eventsRes.rows.length > PRODUCT_EVENTS_EXPORT_LIMIT) {
        throw AppError.payloadTooLarge('Product event export exceeds its limit');
      }
      productEvents = eventsRes.rows.map((e) => ({
        event: e.event_name,
        occurredAt: new Date(e.occurred_at).toISOString(),
        occurredOn: String(e.occurred_on),
        platform: e.platform,
        appVersion: e.app_version
      }));
    } catch (err) {
      if (!isMissingSchemaObject(err)) throw err;
    }

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        timezone: user.timezone,
        locale: user.locale,
        weekStart: user.week_start,
        defaultCurrency: user.default_currency,
        status: user.status,
        createdAt: user.created_at.toISOString(),
        ...(settings
          ? {
              productEventsEnabled: settings.product_events_enabled,
              onboardingCompletedAt: settings.onboarding_completed_at
                ? new Date(settings.onboarding_completed_at).toISOString()
                : null
            }
          : {})
      },
      sessions: sessionsRes.rows.map((s) => ({
        id: s.id,
        devicePlatform: s.device_platform,
        deviceName: s.device_name,
        appVersion: s.app_version,
        createdAt: new Date(s.created_at).toISOString(),
        lastUsedAt: new Date(s.last_used_at).toISOString()
      })),
      // Keep the legacy response shape without reading retired financial data.
      categories: [],
      pushDevices: pushRes.rows.map((p) => ({
        platform: p.platform,
        lastSeenAt: new Date(p.last_seen_at).toISOString(),
        createdAt: new Date(p.created_at).toISOString()
      })),
      productEvents
    };
  }
}
