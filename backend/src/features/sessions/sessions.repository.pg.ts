/**
 * src/features/sessions/sessions.repository.pg.ts
 *
 * Feature guide G6 (ADR-047). Every statement is scoped to the authenticated
 * account (`user_id`). Only device metadata is read from auth_sessions: the
 * column list never includes created_ip, and refresh tokens are never read.
 */

import type pg from 'pg';
import { logger } from '../../core/logger/logger.js';

/** Most sessions listed at once; the current session is always first. */
export const SESSION_LIST_LIMIT = 50;

/** Columns returned to the owner of the sessions. Never add created_ip. */
export const SESSION_LIST_COLUMNS =
  'id, device_platform, device_name, app_version, created_at, last_used_at';

/** How long a rejected 'user_revoked' value is remembered before trying again. */
const REASON_RECHECK_MS = 10 * 60_000;

export interface SessionRow {
  id: string;
  device_platform: 'ios' | 'android' | 'unknown';
  device_name: string | null;
  app_version: string | null;
  created_at: Date;
  last_used_at: Date;
}

export type SessionRevokeReason = 'user_revoked' | 'logout';

export type SessionRevokeResult =
  | { outcome: 'not_found' }
  | { outcome: 'already_ended' }
  | { outcome: 'revoked'; reason: SessionRevokeReason };

export interface SessionsRepository {
  /** Active sessions (not revoked, not expired), current first, then most recently used. */
  listActive(userId: string, currentSessionId: string | null, limit: number): Promise<SessionRow[]>;
  revoke(userId: string, sessionId: string): Promise<SessionRevokeResult>;
}

let userRevokedRejectedAt: number | null = null;

/** Test hook: forget a remembered rejection of 'user_revoked'. */
export function resetSessionRevokeReasonCache(): void {
  userRevokedRejectedAt = null;
}

function isRevokedReasonRejected(err: unknown): boolean {
  const e = err as { code?: unknown; table?: unknown } | null;
  return e?.code === '23514' && (e.table === undefined || e.table === 'auth_sessions');
}

export class PgSessionsRepository implements SessionsRepository {
  constructor(private readonly pool: pg.Pool) {}

  public async listActive(
    userId: string,
    currentSessionId: string | null,
    limit: number
  ): Promise<SessionRow[]> {
    const res = await this.pool.query<SessionRow>(
      `SELECT ${SESSION_LIST_COLUMNS}
         FROM auth_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND absolute_expires_at > now()
        ORDER BY (id = $2::uuid) DESC NULLS LAST, last_used_at DESC, id
        LIMIT $3`,
      [userId, currentSessionId, limit]
    );
    return res.rows;
  }

  /**
   * Ends one session of the account in one transaction: the session, its
   * refresh tokens and its push devices. Unknown ids and other accounts'
   * sessions are 'not_found'; an already ended session is 'already_ended'.
   */
  public async revoke(userId: string, sessionId: string): Promise<SessionRevokeResult> {
    const client = await this.pool.connect();
    let transactionOpen = false;
    // A failed BEGIN may leave an unusable connection: discard it.
    let discardClient = true;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      discardClient = false;
      // Row lock: concurrent revokes of the same session run one after another.
      const found = await client.query<{ revoked_at: Date | null }>(
        'SELECT revoked_at FROM auth_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [sessionId, userId]
      );
      const session = found.rows[0];
      if (!session) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { outcome: 'not_found' };
      }
      const reason =
        session.revoked_at === null ? await this.markRevoked(client, userId, sessionId) : null;
      // Leftover tokens and push devices of an ended session are removed every time.
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now()
          WHERE session_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [sessionId, userId]
      );
      await client.query('DELETE FROM push_devices WHERE session_id = $1 AND user_id = $2', [
        sessionId,
        userId
      ]);
      await client.query('COMMIT');
      transactionOpen = false;
      return reason === null ? { outcome: 'already_ended' } : { outcome: 'revoked', reason };
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
          logger.error('Session revoke rollback failed; discarding connection');
        }
      }
      throw err;
    } finally {
      client.release(discardClient);
    }
  }

  /**
   * Stores revoked_reason 'user_revoked'. Until the owner-run SQL extends the
   * CHECK constraint the database rejects that value; the session is then
   * revoked as 'logout' (same effect) and the rejection is remembered for a while.
   */
  private async markRevoked(
    client: pg.PoolClient,
    userId: string,
    sessionId: string
  ): Promise<SessionRevokeReason> {
    const update = (reason: SessionRevokeReason) =>
      client.query(
        `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = $3
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [sessionId, userId, reason]
      );
    const recentlyRejected =
      userRevokedRejectedAt !== null && Date.now() - userRevokedRejectedAt < REASON_RECHECK_MS;
    if (!recentlyRejected) {
      await client.query('SAVEPOINT session_revoke_reason');
      try {
        await update('user_revoked');
        await client.query('RELEASE SAVEPOINT session_revoke_reason');
        userRevokedRejectedAt = null;
        return 'user_revoked';
      } catch (err) {
        if (!isRevokedReasonRejected(err)) throw err;
        await client.query('ROLLBACK TO SAVEPOINT session_revoke_reason');
        if (userRevokedRejectedAt === null) {
          logger.warn(
            'auth_sessions.revoked_reason does not accept user_revoked yet; storing logout until the owner-run SQL is applied'
          );
        }
        userRevokedRejectedAt = Date.now();
      }
    }
    await update('logout');
    return 'logout';
  }
}
