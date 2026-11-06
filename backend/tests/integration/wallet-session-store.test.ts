import '../infrastructure-safety.js';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import type { DatabaseSchema } from '../../src/infrastructure/database/postgres/kysely.js';
import { createWalletSessionToken } from '../../src/features/wallet-auth/wallet-phone-security.js';
import { WalletSessionStore } from '../../src/features/wallet-auth/wallet-session-store.pg.js';

// Synthetic, randomly generated credentials only. The isolated test database is
// disposable; runtime has no DELETE grant and these inert synthetic rows remain.
describe('independent wallet session storage (unwired, not phone login)', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  const store = new WalletSessionStore(db);
  afterAll(async () => db.destroy());

  async function waitUntilBlockedBy(pid: number) {
    for (let i = 0; i < 200; i++) {
      const row = await pool.query<{ blocked: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
        [pid]
      );
      if (row.rows[0]!.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected a session operation to wait on the row lock');
  }

  it('creates distinct unbound wallet principals and stores only the token digest', async () => {
    const a = await store.create();
    const b = await store.create();
    expect(a.walletAccountId).not.toBe(b.walletAccountId);
    const row = (
      await pool.query<{ wallet_account_id: string; token_hash: Buffer }>(
        'SELECT wallet_account_id, token_hash FROM wallet_account_sessions WHERE id = $1',
        [a.sessionId]
      )
    ).rows[0]!;
    expect(row.wallet_account_id).toBe(a.walletAccountId);
    expect(row.token_hash.equals(a.credential.tokenHash)).toBe(true);
    expect(row.token_hash.includes(Buffer.from(a.credential.token))).toBe(false);
    expect(JSON.stringify(a)).not.toContain(a.credential.token);
    expect(
      await store.withActiveSession(a.credential.token, async (_tx, identity) => identity)
    ).toEqual({
      authenticated: true,
      value: { walletAccountId: a.walletAccountId, sessionId: a.sessionId }
    });
    expect(
      await store.withActiveSession(b.credential.token, async (_tx, identity) => identity)
    ).toEqual({
      authenticated: true,
      value: { walletAccountId: b.walletAccountId, sessionId: b.sessionId }
    });
    await store.revoke(a.credential.token);
    await store.revoke(b.credential.token);
  });

  it('rejects malformed, unknown, expired and revoked credentials without invoking work', async () => {
    const a = await store.create();
    const unknown = createWalletSessionToken();
    const expired = createWalletSessionToken();
    await pool.query(
      `INSERT INTO wallet_account_sessions (wallet_account_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, clock_timestamp() - interval '2 days', clock_timestamp() - interval '1 day')`,
      [a.walletAccountId, expired.tokenHash]
    );
    const work = async () => {
      throw new Error('should not run');
    };
    for (const token of ['not-a-wallet-token', unknown.token, expired.token]) {
      expect(await store.withActiveSession(token, work)).toEqual({ authenticated: false });
    }
    expect(await store.revoke(a.credential.token)).toBe(true);
    expect(await store.revoke(a.credential.token)).toBe(false);
    expect(await store.revoke('bad')).toBe(false);
    expect(await store.withActiveSession(a.credential.token, work)).toEqual({
      authenticated: false
    });
  });

  it('enforces token digest shape, uniqueness and principal foreign keys', async () => {
    const a = await store.create();
    await expect(
      pool.query(
        `INSERT INTO wallet_account_sessions (wallet_account_id, token_hash, expires_at)
       VALUES ($1, $2, clock_timestamp() + interval '1 day')`,
        [a.walletAccountId, a.credential.tokenHash]
      )
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `INSERT INTO wallet_account_sessions (wallet_account_id, token_hash, expires_at)
       VALUES ($1, $2, clock_timestamp() + interval '1 day')`,
        [a.walletAccountId, Buffer.alloc(3)]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO wallet_account_sessions (wallet_account_id, token_hash, expires_at)
       VALUES ($1, $2, clock_timestamp() + interval '1 day')`,
        ['00000000-0000-4000-8000-000000000001', createWalletSessionToken().tokenHash]
      )
    ).rejects.toMatchObject({ code: '23503' });
    await store.revoke(a.credential.token);
  });

  it('enforces immutable identity and final revocation for the least-privileged role', async () => {
    const a = await store.create();
    const b = await store.create();
    const attempts: Array<[string, unknown[]]> = [
      [
        'UPDATE wallet_account_sessions SET wallet_account_id = $2 WHERE id = $1',
        [a.sessionId, b.walletAccountId]
      ],
      [
        'UPDATE wallet_account_sessions SET token_hash = $2 WHERE id = $1',
        [a.sessionId, b.credential.tokenHash]
      ],
      [
        "UPDATE wallet_account_sessions SET expires_at = clock_timestamp() + interval '2 days' WHERE id = $1",
        [a.sessionId]
      ],
      ['UPDATE wallet_accounts SET id = $2 WHERE id = $1', [a.walletAccountId, b.walletAccountId]],
      ['DELETE FROM wallet_account_sessions WHERE id = $1', [a.sessionId]],
      ['DELETE FROM wallet_accounts WHERE id = $1', [a.walletAccountId]]
    ];
    for (const [statement, params] of attempts) {
      await expect(pool.query(statement, params)).rejects.toMatchObject({ code: '42501' });
    }
    expect(await store.revoke(a.credential.token)).toBe(true);
    await expect(
      pool.query('UPDATE wallet_account_sessions SET revoked_at = NULL WHERE id = $1', [
        a.sessionId
      ])
    ).rejects.toMatchObject({ message: 'wallet session revocation is final' });
    expect(await store.withActiveSession(a.credential.token, async () => true)).toEqual({
      authenticated: false
    });
    await store.revoke(b.credential.token);
  });

  it('rolls back callback writes on failure', async () => {
    const a = await store.create();
    await expect(
      store.withActiveSession(a.credential.token, async (trx, identity) => {
        await trx
          .updateTable('wallet_account_sessions')
          .set({ revoked_at: new Date() })
          .where('id', '=', identity.sessionId)
          .execute();
        throw new Error('synthetic rollback');
      })
    ).rejects.toThrow('synthetic rollback');
    expect(await store.withActiveSession(a.credential.token, async () => true)).toEqual({
      authenticated: true,
      value: true
    });
    await store.revoke(a.credential.token);
  });

  it('lets an already locked transaction finish before a concurrent logout', async () => {
    const a = await store.create();
    let entered!: (pid: number) => void;
    let release!: () => void;
    const enteredPromise = new Promise<number>((resolve) => {
      entered = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = store.withActiveSession(a.credential.token, async (trx) => {
      const { rows } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(trx);
      entered(rows[0]!.pid);
      await releasePromise;
      return 'committed';
    });
    const pid = await enteredPromise;
    const revoke = store.revoke(a.credential.token);
    try {
      await waitUntilBlockedBy(pid);
    } finally {
      release();
    }
    expect(await work).toEqual({ authenticated: true, value: 'committed' });
    expect(await revoke).toBe(true);
    expect(await store.withActiveSession(a.credential.token, async () => true)).toEqual({
      authenticated: false
    });
  });

  it('rejects a waiting operation if logout commits first', async () => {
    const a = await store.create();
    const locker = await pool.connect();
    try {
      await locker.query('BEGIN');
      const pid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await locker.query(
        'UPDATE wallet_account_sessions SET revoked_at = clock_timestamp() WHERE id = $1',
        [a.sessionId]
      );
      const work = store.withActiveSession(a.credential.token, async () => 'must not run');
      await waitUntilBlockedBy(pid);
      await locker.query('COMMIT');
      expect(await work).toEqual({ authenticated: false });
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
  });

  it('makes concurrent logout idempotent for the same token', async () => {
    const a = await store.create();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.revoke(a.credential.token))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.withActiveSession(a.credential.token, async () => true)).toEqual({
      authenticated: false
    });
  });

  it('rechecks expiry after waiting for a session lock', async () => {
    const a = await store.create();
    const temporary = createWalletSessionToken();
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO wallet_account_sessions (wallet_account_id, token_hash, expires_at)
       VALUES ($1, $2, clock_timestamp() + interval '1 second') RETURNING id`,
      [a.walletAccountId, temporary.tokenHash]
    );
    const locker = await pool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM wallet_account_sessions WHERE id = $1 FOR UPDATE', [
        inserted.rows[0]!.id
      ]);
      const pid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      const work = store.withActiveSession(temporary.token, async () => 'must not run');
      await waitUntilBlockedBy(pid);
      await new Promise((resolve) => setTimeout(resolve, 1300));
      await locker.query('COMMIT');
      expect(await work).toEqual({ authenticated: false });
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
      await store.revoke(a.credential.token);
    }
  });
});
