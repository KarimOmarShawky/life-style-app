/**
 * src/core/security/session-validator.ts
 *
 * Implements Section 8.1 & 8.2.1: SessionValidator abstraction and PostgreSQL implementation.
 * Performs single-query indexed verification of session and user lifecycle state.
 */

import type pg from 'pg';

export interface AuthenticatedUserContext {
  id: string;
  email: string;
  status: 'active' | 'disabled' | 'pending_deletion';
  timezone: string;
  locale: string;
  weekStart: number;
  defaultCurrency: string;
  pushShowTitles: boolean;
}

export interface ValidatedSessionResult {
  sessionId: string;
  userId: string;
  revokedAt: Date | null;
  absoluteExpiresAt: Date;
  user: AuthenticatedUserContext;
}

export interface SessionValidator {
  validateSession(sid: string, sub: string): Promise<ValidatedSessionResult | null>;
}

export class PgSessionValidator implements SessionValidator {
  constructor(private readonly pool: pg.Pool) {}

  public async validateSession(sid: string, sub: string): Promise<ValidatedSessionResult | null> {
    const query = `
      SELECT 
        s.id AS session_id,
        s.user_id,
        s.revoked_at,
        s.absolute_expires_at,
        u.id AS u_id,
        u.email,
        u.status,
        u.timezone,
        u.locale,
        u.week_start,
        u.default_currency,
        u.push_show_titles
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2
      LIMIT 1
    `;

    const res = await this.pool.query(query, [sid, sub]);
    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      absoluteExpiresAt: new Date(row.absolute_expires_at),
      user: {
        id: row.u_id,
        email: row.email,
        status: row.status,
        timezone: row.timezone,
        locale: row.locale,
        weekStart: row.week_start,
        defaultCurrency: row.default_currency,
        pushShowTitles: row.push_show_titles
      }
    };
  }
}
