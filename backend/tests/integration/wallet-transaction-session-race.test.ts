import '../infrastructure-safety.js';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSchema } from '../../src/infrastructure/database/postgres/kysely.js';
import { PgMoneyRepository } from '../../src/features/money/money.repository.pg.js';

// Dedicated synthetic rows and no SMS, provider, or network calls.
describe('strict wallet transaction session commit boundary', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  const repository = new PgMoneyRepository(db);
  const owner = randomUUID();
  const session = randomUUID();
  let tokenId: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [owner]);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, display_name, default_currency)
       VALUES ($1, $2, 'test', 'test', 'EGP')`,
      [owner, `${owner}@example.test`]
    );
    await pool.query(
      `INSERT INTO auth_sessions (id, user_id, absolute_expires_at, device_platform)
       VALUES ($1, $2, now() + interval '1 day', 'android')`,
      [session, owner]
    );
    tokenId = (
      await pool.query<{ id: string }>(
        `INSERT INTO ingest_tokens (user_id, session_id, token_hash)
         VALUES ($1, $2, $3) RETURNING id`,
        [owner, session, randomBytes(32)]
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [owner]);
    await db.destroy();
  });

  const input = () => ({
    kind: 'expense' as const,
    amount: '10.00',
    currency: 'EGP',
    occurredOn: '2026-11-05',
    idempotencyKey: randomUUID(),
    idempotencyFingerprint: randomBytes(32)
  });
  const audit = {
    actorType: 'user' as const,
    eventType: 'transaction.created',
    outcome: 'success' as const
  };
  const create = (fence: { sessionId: string; ingestTokenId?: string }) =>
    repository.createTransaction(owner, input(), audit, fence);

  async function count() {
    const result = await pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM transactions WHERE user_id = $1',
      [owner]
    );
    return Number(result.rows[0]!.n);
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
    throw new Error('expected wallet transaction to wait on the session lock');
  }

  it('allows a live account session and a live ingest token', async () => {
    await create({ sessionId: session });
    await create({ sessionId: session, ingestTokenId: tokenId });
    expect(await count()).toBe(2);
  });

  it('rejects a different, revoked or expired session before insertion', async () => {
    await expect(create({ sessionId: randomUUID() })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
    await pool.query(
      "UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1",
      [session]
    );
    await expect(create({ sessionId: session })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await pool.query(
      "UPDATE auth_sessions SET revoked_at = NULL, revoked_reason = NULL, absolute_expires_at = now() - interval '1 second' WHERE id = $1",
      [session]
    );
    await expect(create({ sessionId: session })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await count()).toBe(0);
  });

  it('rejects a revoked or foreign ingest token before insertion', async () => {
    await expect(create({ sessionId: session, ingestTokenId: randomUUID() })).rejects.toMatchObject(
      { code: 'UNAUTHENTICATED' }
    );
    await pool.query('UPDATE ingest_tokens SET revoked_at = now() WHERE id = $1', [tokenId]);
    await expect(create({ sessionId: session, ingestTokenId: tokenId })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
    expect(await count()).toBe(0);
  });

  it('rejects a real session and ingest token belonging to another account', async () => {
    const other = randomUUID();
    const otherSession = randomUUID();
    try {
      await pool.query(
        "INSERT INTO users (id, email, password_hash, display_name, default_currency) VALUES ($1, $2, 'test', 'other', 'EGP')",
        [other, `${other}@example.test`]
      );
      await pool.query(
        "INSERT INTO auth_sessions (id, user_id, absolute_expires_at, device_platform) VALUES ($1, $2, now() + interval '1 day', 'android')",
        [otherSession, other]
      );
      const otherToken = (
        await pool.query<{ id: string }>(
          'INSERT INTO ingest_tokens (user_id, session_id, token_hash) VALUES ($1, $2, $3) RETURNING id',
          [other, otherSession, randomBytes(32)]
        )
      ).rows[0]!.id;
      await expect(create({ sessionId: otherSession })).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      });
      await expect(create({ sessionId: session, ingestTokenId: otherToken })).rejects.toMatchObject(
        { code: 'UNAUTHENTICATED' }
      );
      expect(await count()).toBe(0);
    } finally {
      await pool.query('DELETE FROM users WHERE id = $1', [other]);
    }
  });

  it('orders a write that acquired the session lock before logout', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE transactions IN ACCESS EXCLUSIVE MODE');
      const pid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      const write = create({ sessionId: session, ingestTokenId: tokenId });
      await waitUntilBlockedBy(pid);
      const logout = pool.query(
        "UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1",
        [session]
      );
      let chainLength = 0;
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await pool.query<{ count: number }>(
          `WITH RECURSIVE blocked(pid) AS (
             SELECT $1::int UNION
             SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
           ) SELECT (count(*) - 1)::int AS count FROM blocked`,
          [pid]
        );
        chainLength = result.rows[0]!.count;
        if (chainLength >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(chainLength).toBeGreaterThanOrEqual(2);
      await holder.query('COMMIT');
      await write;
      await logout;
      expect(await count()).toBe(1);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('checks expiration after waiting on the session row lock', async () => {
    const holder = await pool.connect();
    try {
      await pool.query(
        "UPDATE auth_sessions SET absolute_expires_at = clock_timestamp() + interval '2 seconds' WHERE id = $1",
        [session]
      );
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM auth_sessions WHERE id = $1 FOR UPDATE', [session]);
      const pid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      const result = create({ sessionId: session }).then(
        () => null,
        (error: unknown) => error
      );
      await waitUntilBlockedBy(pid);
      await new Promise((resolve) => setTimeout(resolve, 2100));
      await holder.query('COMMIT');
      expect(await result).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(await count()).toBe(0);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it.each(['logout', 'token revoke'] as const)(
    'does not insert when %s acquires the shared session lock and commits first',
    async (operation) => {
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM auth_sessions WHERE id = $1 FOR UPDATE', [session]);
        const pid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
          .pid;
        const result = create({ sessionId: session, ingestTokenId: tokenId }).then(
          () => null,
          (error: unknown) => error
        );
        await waitUntilBlockedBy(pid);
        if (operation === 'logout') {
          await holder.query(
            "UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1",
            [session]
          );
        } else {
          await holder.query('UPDATE ingest_tokens SET revoked_at = now() WHERE id = $1', [
            tokenId
          ]);
        }
        await holder.query('COMMIT');
        expect(await result).toMatchObject({ code: 'UNAUTHENTICATED' });
        expect(await count()).toBe(0);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
    }
  );
});
