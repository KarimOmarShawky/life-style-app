/**
 * src/features/ingest/ingest.repository.pg.ts
 *
 * PostgreSQL implementation of the ingest token store. Only SHA-256 digests are persisted.
 */

import type pg from 'pg';
import { AppError } from '../../core/errors/app-error.js';
import type { IngestTokenRecord, IngestTokenRepository } from './ingest.repository.js';

export class PgIngestTokenRepository implements IngestTokenRepository {
  constructor(private readonly pool: pg.Pool) {}

  async replaceForSession(input: {
    userId: string;
    sessionId: string;
    tokenHash: Buffer;
  }): Promise<void> {
    // Serialize rotations and logout on the session row, including the case
    // where no ingest-token row exists yet.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT id FROM auth_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [input.sessionId, input.userId]
      );
      // Evaluate expiry *after* any lock wait; transaction-stable now() could
      // otherwise validate a session that expired while the lock was held.
      const active =
        locked.rowCount === 1 &&
        (
          await client.query(
            `SELECT id FROM auth_sessions WHERE id = $1 AND revoked_at IS NULL
           AND absolute_expires_at > clock_timestamp()`,
            [input.sessionId]
          )
        ).rowCount === 1;
      if (!active) {
        throw AppError.unauthenticated('Session is invalid or has been revoked', 'UNAUTHENTICATED');
      }
      await client.query(
        'UPDATE ingest_tokens SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL',
        [input.sessionId]
      );
      await client.query(
        'INSERT INTO ingest_tokens (user_id, session_id, token_hash) VALUES ($1, $2, $3)',
        [input.userId, input.sessionId, input.tokenHash]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async revokeForSession(sessionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // The same lock also orders a revoke against an in-flight first issue.
      await client.query('SELECT id FROM auth_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      await client.query(
        'UPDATE ingest_tokens SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL',
        [sessionId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async findActiveByHash(tokenHash: Buffer): Promise<IngestTokenRecord | null> {
    const result = await this.pool.query<{ id: string; user_id: string; session_id: string }>(
      'SELECT id, user_id, session_id FROM ingest_tokens WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1',
      [tokenHash]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, userId: row.user_id, sessionId: row.session_id };
  }

  async markUsed(id: string): Promise<void> {
    // Written at most once an hour per token, so a burst of SMS does not turn into a write storm.
    await this.pool.query(
      "UPDATE ingest_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 hour')",
      [id]
    );
  }
}
