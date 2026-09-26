/**
 * src/features/users/users.repository.pg.ts
 *
 * Implements Section 14.3: PostgreSQL Implementation of UsersRepository.
 */

import type pg from 'pg';
import type { UsersRepository } from './users.repository.js';
import type { UserRow } from '../auth/auth.types.js';
import type {
  UpdateUserProfileInput,
  RegisterPushDeviceInput,
  UserExportData
} from './users.types.js';

export class PgUsersRepository implements UsersRepository {
  constructor(private readonly pool: pg.Pool) {}

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

    const query = `
      UPDATE users 
      SET ${setClauses.join(', ')} 
      WHERE id = $1 
      RETURNING *
    `;

    const res = await this.pool.query<UserRow>(query, values);
    return res.rows[0]!;
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

  public async scheduleDeletion(userId: string, scheduledFor: Date): Promise<void> {
    await this.pool.query(
      `UPDATE users 
       SET status = 'pending_deletion', deletion_scheduled_for = $1, updated_at = now() 
       WHERE id = $2`,
      [scheduledFor, userId]
    );
  }

  public async cancelDeletion(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE users 
       SET status = 'active', deletion_scheduled_for = NULL, updated_at = now() 
       WHERE id = $1`,
      [userId]
    );
  }

  public async getUserExportData(userId: string): Promise<UserExportData> {
    const userRes = await this.pool.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [userId]);
    const user = userRes.rows[0]!;

    const sessionsRes = await this.pool.query(
      `SELECT id, device_platform, device_name, app_version, created_at, last_used_at 
       FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    const categoriesRes = await this.pool.query(
      `SELECT id, kind, name, color FROM categories WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );

    const pushRes = await this.pool.query(
      `SELECT platform, last_seen_at, created_at FROM push_devices WHERE user_id = $1`,
      [userId]
    );

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
        createdAt: user.created_at.toISOString()
      },
      sessions: sessionsRes.rows.map((s) => ({
        id: s.id,
        devicePlatform: s.device_platform,
        deviceName: s.device_name,
        appVersion: s.app_version,
        createdAt: new Date(s.created_at).toISOString(),
        lastUsedAt: new Date(s.last_used_at).toISOString()
      })),
      categories: categoriesRes.rows.map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        color: c.color
      })),
      pushDevices: pushRes.rows.map((p) => ({
        platform: p.platform,
        lastSeenAt: new Date(p.last_seen_at).toISOString(),
        createdAt: new Date(p.created_at).toISOString()
      }))
    };
  }
}
