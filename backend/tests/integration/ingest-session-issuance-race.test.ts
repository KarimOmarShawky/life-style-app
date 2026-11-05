import '../infrastructure-safety.js';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PgIngestTokenRepository } from '../../src/features/ingest/ingest.repository.pg.js';

/** Uses dedicated rows in the disposable integration DB; no SMS or provider calls. */
describe('ingest token issuance session boundary', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const repository = new PgIngestTokenRepository(pool);
  const owner = randomUUID();
  const session = randomUUID();
  const email = `${owner}@example.test`;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [owner]);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, display_name, default_currency)
       VALUES ($1, $2, 'test', 'test', 'EGP')`,
      [owner, email]
    );
    await pool.query(
      `INSERT INTO auth_sessions (id, user_id, absolute_expires_at, device_platform)
       VALUES ($1, $2, now() + interval '1 day', 'android')`,
      [session, owner]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [owner]);
    await pool.end();
  });

  async function activeCount() {
    const result = await pool.query<{ count: string }>(
      'SELECT count(*) FROM ingest_tokens WHERE session_id = $1 AND revoked_at IS NULL',
      [session]
    );
    return Number(result.rows[0]!.count);
  }

  async function backendPid(client: pg.PoolClient): Promise<number> {
    const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    return result.rows[0]!.pid;
  }

  async function waitUntilBlockedBy(pid: number) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await pool.query<{ blocked: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
        [pid]
      );
      if (result.rows[0]!.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('expected the operation to wait on the session lock');
  }

  it('refuses issuance for revoked, expired, and different-account sessions', async () => {
    await pool.query(
      "UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1",
      [session]
    );
    await expect(
      repository.replaceForSession({
        userId: owner,
        sessionId: session,
        tokenHash: randomBytes(32)
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await pool.query(
      "UPDATE auth_sessions SET revoked_at = NULL, revoked_reason = NULL, absolute_expires_at = now() - interval '1 second' WHERE id = $1",
      [session]
    );
    await expect(
      repository.replaceForSession({
        userId: owner,
        sessionId: session,
        tokenHash: randomBytes(32)
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await pool.query(
      "UPDATE auth_sessions SET absolute_expires_at = now() + interval '1 day' WHERE id = $1",
      [session]
    );
    await expect(
      repository.replaceForSession({
        userId: randomUUID(),
        sessionId: session,
        tokenHash: randomBytes(32)
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await activeCount()).toBe(0);
  });

  it('does not issue when logout holds the session lock and commits first', async () => {
    const logout = await pool.connect();
    try {
      await logout.query('BEGIN');
      await logout.query('SELECT id FROM auth_sessions WHERE id = $1 FOR UPDATE', [session]);
      const issue = repository
        .replaceForSession({ userId: owner, sessionId: session, tokenHash: randomBytes(32) })
        .then(
          () => null,
          (error: unknown) => error
        );
      await waitUntilBlockedBy(await backendPid(logout));
      await logout.query(
        "UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1",
        [session]
      );
      await logout.query('COMMIT');
      expect(await issue).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(await activeCount()).toBe(0);
    } finally {
      await logout.query('ROLLBACK').catch(() => undefined);
      logout.release();
    }
  });

  it('checks expiration after waiting for the session lock', async () => {
    const holder = await pool.connect();
    try {
      await pool.query(
        "UPDATE auth_sessions SET absolute_expires_at = clock_timestamp() + interval '2 seconds' WHERE id = $1",
        [session]
      );
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM auth_sessions WHERE id = $1 FOR UPDATE', [session]);
      const issue = repository
        .replaceForSession({ userId: owner, sessionId: session, tokenHash: randomBytes(32) })
        .then(
          () => null,
          (error: unknown) => error
        );
      await waitUntilBlockedBy(await backendPid(holder));
      await new Promise((resolve) => setTimeout(resolve, 2100));
      await holder.query('COMMIT');
      expect(await issue).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(await activeCount()).toBe(0);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('orders token revocation on the same session row even with no token', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM auth_sessions WHERE id = $1 FOR UPDATE', [session]);
      const revoke = repository.revokeForSession(session);
      await waitUntilBlockedBy(await backendPid(holder));
      await holder.query('COMMIT');
      await revoke;
      expect(await activeCount()).toBe(0);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('serializes concurrent rotations and leaves exactly one active token', async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.replaceForSession({
          userId: owner,
          sessionId: session,
          tokenHash: randomBytes(32)
        })
      )
    );
    expect(await activeCount()).toBe(1);
  });
});
