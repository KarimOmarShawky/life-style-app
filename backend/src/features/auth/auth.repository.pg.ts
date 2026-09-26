/**
 * src/features/auth/auth.repository.pg.ts
 *
 * Implements Section 6.3 & 6.7: PostgreSQL implementation of AuthRepository.
 */

import type pg from 'pg';
import type {
  AuthRepository,
  CreateUserData,
  CreateSessionData,
  CreateRefreshTokenData,
  TokenWithSessionAndUser
} from './auth.repository.js';
import type { UserRow, AuthSession, RefreshTokenRow } from './auth.types.js';

const DEFAULT_CATEGORIES = [
  { name: 'Food & Dining', kind: 'expense', color: '#FF5722' },
  { name: 'Housing', kind: 'expense', color: '#3F51B5' },
  { name: 'Transportation', kind: 'expense', color: '#009688' },
  { name: 'Utilities', kind: 'expense', color: '#FF9800' },
  { name: 'Entertainment', kind: 'expense', color: '#9C27B0' },
  { name: 'Healthcare', kind: 'expense', color: '#E91E63' },
  { name: 'General', kind: 'expense', color: '#607D8B' },
  { name: 'Salary', kind: 'income', color: '#4CAF50' },
  { name: 'Freelance', kind: 'income', color: '#8BC34A' },
  { name: 'Investments', kind: 'income', color: '#00BCD4' },
  { name: 'Other Income', kind: 'income', color: '#9E9E9E' }
];

export class PgAuthRepository implements AuthRepository {
  constructor(private readonly pool: pg.Pool) {}

  private getExecutor(client?: pg.PoolClient): pg.Pool | pg.PoolClient {
    return client ?? this.pool;
  }

  public async findUserByEmail(email: string): Promise<UserRow | null> {
    const query = `
      SELECT * FROM users 
      WHERE email = $1::citext 
      LIMIT 1
    `;
    const res = await this.pool.query<UserRow>(query, [email.trim().toLowerCase()]);
    return res.rows[0] ?? null;
  }

  public async findUserById(id: string): Promise<UserRow | null> {
    const query = `
      SELECT * FROM users 
      WHERE id = $1 
      LIMIT 1
    `;
    const res = await this.pool.query<UserRow>(query, [id]);
    return res.rows[0] ?? null;
  }

  public async createUser(data: CreateUserData, client?: pg.PoolClient): Promise<UserRow> {
    const executor = this.getExecutor(client);
    const query = `
      INSERT INTO users (
        email, password_hash, display_name, timezone, locale, default_currency
      ) VALUES ($1::citext, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      data.email.trim().toLowerCase(),
      data.passwordHash,
      data.displayName.trim(),
      data.timezone,
      data.locale,
      data.defaultCurrency
    ];

    const res = await executor.query<UserRow>(query, values);
    return res.rows[0]!;
  }

  public async createDefaultCategories(userId: string, client?: pg.PoolClient): Promise<void> {
    const executor = this.getExecutor(client);
    for (const cat of DEFAULT_CATEGORIES) {
      await executor.query(
        `INSERT INTO categories (user_id, kind, name, color) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [userId, cat.kind, cat.name, cat.color]
      );
    }
  }

  public async createSession(
    data: CreateSessionData,
    client?: pg.PoolClient
  ): Promise<AuthSession> {
    const executor = this.getExecutor(client);
    const query = `
      INSERT INTO auth_sessions (
        user_id, absolute_expires_at, device_platform, device_name, app_version, created_ip
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING 
        id, user_id as "userId", created_at as "createdAt", last_used_at as "lastUsedAt",
        absolute_expires_at as "absoluteExpiresAt", revoked_at as "revokedAt",
        revoked_reason as "revokedReason", device_platform as "devicePlatform",
        device_name as "deviceName", app_version as "appVersion", created_ip as "createdIp"
    `;
    const values = [
      data.userId,
      data.absoluteExpiresAt,
      data.devicePlatform,
      data.deviceName ?? null,
      data.appVersion ?? null,
      data.createdIp ?? null
    ];

    const res = await executor.query<AuthSession>(query, values);
    return res.rows[0]!;
  }

  public async createRefreshToken(
    data: CreateRefreshTokenData,
    client?: pg.PoolClient
  ): Promise<RefreshTokenRow> {
    const executor = this.getExecutor(client);
    const query = `
      INSERT INTO refresh_tokens (
        session_id, user_id, token_hash, expires_at
      ) VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const values = [data.sessionId, data.userId, data.tokenHash, data.expiresAt];

    const res = await executor.query<RefreshTokenRow>(query, values);
    return res.rows[0]!;
  }

  public async findRefreshTokenWithSession(
    tokenHash: Buffer
  ): Promise<TokenWithSessionAndUser | null> {
    const query = `
      SELECT 
        rt.id as rt_id, rt.session_id, rt.user_id, rt.token_hash, rt.issued_at,
        rt.expires_at, rt.rotated_at, rt.replaced_by, rt.revoked_at as rt_revoked_at,
        s.id as s_id, s.user_id as s_user_id, s.created_at as s_created_at,
        s.last_used_at, s.absolute_expires_at, s.revoked_at as s_revoked_at,
        s.revoked_reason, s.device_platform, s.device_name, s.app_version, s.created_ip,
        u.*
      FROM refresh_tokens rt
      JOIN auth_sessions s ON s.id = rt.session_id
      JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1
      LIMIT 1
    `;

    const res = await this.pool.query(query, [tokenHash]);
    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      token: {
        id: row.rt_id,
        session_id: row.session_id,
        user_id: row.user_id,
        token_hash: row.token_hash,
        issued_at: new Date(row.issued_at),
        expires_at: new Date(row.expires_at),
        rotated_at: row.rotated_at ? new Date(row.rotated_at) : null,
        replaced_by: row.replaced_by,
        revoked_at: row.rt_revoked_at ? new Date(row.rt_revoked_at) : null
      },
      session: {
        id: row.s_id,
        userId: row.s_user_id,
        createdAt: new Date(row.s_created_at),
        lastUsedAt: new Date(row.last_used_at),
        absoluteExpiresAt: new Date(row.absolute_expires_at),
        revokedAt: row.s_revoked_at ? new Date(row.s_revoked_at) : null,
        revokedReason: row.revoked_reason,
        devicePlatform: row.device_platform,
        deviceName: row.device_name,
        appVersion: row.app_version,
        createdIp: row.created_ip
      },
      user: {
        id: row.id,
        email: row.email,
        password_hash: row.password_hash,
        display_name: row.display_name,
        timezone: row.timezone,
        locale: row.locale,
        week_start: row.week_start,
        default_currency: row.default_currency,
        status: row.status,
        email_verified_at: row.email_verified_at ? new Date(row.email_verified_at) : null,
        password_changed_at: new Date(row.password_changed_at),
        last_login_at: row.last_login_at ? new Date(row.last_login_at) : null,
        deletion_scheduled_for: row.deletion_scheduled_for
          ? new Date(row.deletion_scheduled_for)
          : null,
        push_show_titles: row.push_show_titles,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at)
      }
    };
  }

  public async rotateRefreshToken(
    oldTokenId: string,
    newToken: CreateRefreshTokenData,
    client?: pg.PoolClient
  ): Promise<boolean> {
    const executor = this.getExecutor(client);

    // Atomic update step per Section 8.2.4:
    // UPDATE refresh_tokens SET rotated_at = now() WHERE id = $id AND rotated_at IS NULL AND revoked_at IS NULL
    const updateRes = await executor.query(
      `UPDATE refresh_tokens 
       SET rotated_at = now() 
       WHERE id = $1 AND rotated_at IS NULL AND revoked_at IS NULL`,
      [oldTokenId]
    );

    if (updateRes.rowCount !== 1) {
      return false; // Lost race or already rotated/revoked
    }

    // Insert new refresh token
    const insertRes = await executor.query(
      `INSERT INTO refresh_tokens (
         session_id, user_id, token_hash, expires_at
       ) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [newToken.sessionId, newToken.userId, newToken.tokenHash, newToken.expiresAt]
    );

    const newTokenId = insertRes.rows[0].id;

    // Link replaced_by and update session last_used_at
    await executor.query(`UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2`, [
      newTokenId,
      oldTokenId
    ]);

    await executor.query(`UPDATE auth_sessions SET last_used_at = now() WHERE id = $1`, [
      newToken.sessionId
    ]);

    return true;
  }

  public async revokeSession(
    sessionId: string,
    reason: string,
    client?: pg.PoolClient
  ): Promise<void> {
    const executor = this.getExecutor(client);
    await executor.query(
      `UPDATE auth_sessions 
       SET revoked_at = now(), revoked_reason = $1 
       WHERE id = $2 AND revoked_at IS NULL`,
      [reason, sessionId]
    );
  }

  public async revokeAllUserSessions(
    userId: string,
    reason: string,
    exceptSessionId?: string,
    client?: pg.PoolClient
  ): Promise<void> {
    const executor = this.getExecutor(client);
    let query = `
      UPDATE auth_sessions 
      SET revoked_at = now(), revoked_reason = $1 
      WHERE user_id = $2 AND revoked_at IS NULL
    `;
    const values: (string | undefined)[] = [reason, userId];

    if (exceptSessionId) {
      query += ` AND id != $3`;
      values.push(exceptSessionId);
    }

    await executor.query(query, values);
  }

  public async updateUserPassword(
    userId: string,
    passwordHash: string,
    client?: pg.PoolClient
  ): Promise<void> {
    const executor = this.getExecutor(client);
    await executor.query(
      `UPDATE users 
       SET password_hash = $1, password_changed_at = now(), updated_at = now() 
       WHERE id = $2`,
      [passwordHash, userId]
    );
  }

  public async updateLastLogin(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`,
      [userId]
    );
  }

  public async deleteSessionPushDevices(sessionId: string, client?: pg.PoolClient): Promise<void> {
    const executor = this.getExecutor(client);
    await executor.query(`DELETE FROM push_devices WHERE session_id = $1`, [sessionId]);
  }

  public async deleteAllUserPushDevices(
    userId: string,
    exceptSessionId?: string,
    client?: pg.PoolClient
  ): Promise<void> {
    const executor = this.getExecutor(client);
    let query = `DELETE FROM push_devices WHERE user_id = $1`;
    const values: (string | undefined)[] = [userId];

    if (exceptSessionId) {
      query += ` AND session_id != $2`;
      values.push(exceptSessionId);
    }

    await executor.query(query, values);
  }
}
