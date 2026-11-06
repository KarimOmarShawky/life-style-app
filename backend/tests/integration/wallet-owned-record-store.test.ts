import '../infrastructure-safety.js';
import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import type { DatabaseSchema } from '../../src/infrastructure/database/postgres/kysely.js';
import { createWalletSessionToken } from '../../src/features/wallet-auth/wallet-phone-security.js';
import { WalletSessionStore } from '../../src/features/wallet-auth/wallet-session-store.pg.js';
import { WalletOwnedRecordStore } from '../../src/features/wallet-auth/wallet-owned-record-store.pg.js';

// Only synthetic bytes, which intentionally are NOT claimed to be encrypted.
// The isolated disposable DB retains rows because the runtime has no DELETE grant.
describe('unwired wallet-owned immutable envelope storage', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  const sessions = new WalletSessionStore(db);
  const records = new WalletOwnedRecordStore(sessions);
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
    throw new Error('Expected an operation to wait on the row lock');
  }

  it('reads and writes only the authenticated wallet, including the same ID in different wallets', async () => {
    const a = await sessions.create();
    const b = await sessions.create();
    const id = randomUUID();
    const aBytes = Buffer.from('synthetic a');
    const bBytes = Buffer.from('synthetic b');
    expect(await records.put(a.credential.token, id, 'review', aBytes)).toEqual({
      authenticated: true,
      value: 'created'
    });
    expect(await records.get(b.credential.token, id)).toEqual({ authenticated: true, value: null });
    expect(await records.put(b.credential.token, id, 'quarantine', bBytes)).toEqual({
      authenticated: true,
      value: 'created'
    });
    const result = await records.get(a.credential.token, id);
    expect(result.authenticated).toBe(true);
    if (!result.authenticated || !result.value) throw new Error('missing synthetic record');
    expect(result.value.kind).toBe('review');
    expect(result.value.envelope.equals(aBytes)).toBe(true);
    expect(JSON.stringify(result.value)).not.toContain('synthetic');
    expect(inspect(result.value)).not.toContain('synthetic');
    result.value.envelope.fill(0);
    expect(result.value.envelope.equals(aBytes)).toBe(true);
    const other = await records.get(b.credential.token, id);
    if (!other.authenticated || !other.value) throw new Error('missing synthetic record');
    expect(other.value.envelope.equals(bBytes)).toBe(true);
    await sessions.revoke(a.credential.token);
    await sessions.revoke(b.credential.token);
  });

  it('accepts only identical replay and never overwrites a different kind or envelope', async () => {
    const a = await sessions.create();
    const id = randomUUID();
    const bytes = Buffer.from('synthetic');
    expect(await records.put(a.credential.token, id, 'candidate', bytes)).toEqual({
      authenticated: true,
      value: 'created'
    });
    expect(await records.put(a.credential.token, id, 'candidate', bytes)).toEqual({
      authenticated: true,
      value: 'replayed'
    });
    expect(await records.put(a.credential.token, id, 'review', bytes)).toEqual({
      authenticated: true,
      value: 'conflict'
    });
    expect(
      await records.put(a.credential.token, id, 'candidate', Buffer.from('different'))
    ).toEqual({ authenticated: true, value: 'conflict' });
    const row = await pool.query<{ kind: string; envelope: Buffer }>(
      'SELECT kind, envelope FROM wallet_owned_records WHERE wallet_account_id = $1 AND id = $2',
      [a.walletAccountId, id]
    );
    expect(row.rows[0]!.kind).toBe('candidate');
    expect(row.rows[0]!.envelope.equals(bytes)).toBe(true);
    await sessions.revoke(a.credential.token);
  });

  it('serializes competing writes from two sessions without replacing either record', async () => {
    const a = await sessions.create();
    const second = createWalletSessionToken();
    await pool.query(
      `INSERT INTO wallet_account_sessions (wallet_account_id, token_hash, expires_at)
      VALUES ($1, $2, clock_timestamp() + interval '1 day')`,
      [a.walletAccountId, second.tokenHash]
    );
    const id = randomUUID();
    const [first, other] = await Promise.all([
      records.put(a.credential.token, id, 'review', Buffer.from('one')),
      records.put(second.token, id, 'review', Buffer.from('two'))
    ]);
    expect([first, other].filter((r) => r.authenticated && r.value === 'created')).toHaveLength(1);
    expect([first, other].filter((r) => r.authenticated && r.value === 'conflict')).toHaveLength(1);
    const row = await pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM wallet_owned_records WHERE wallet_account_id = $1 AND id = $2',
      [a.walletAccountId, id]
    );
    expect(row.rows[0]!.n).toBe('1');
    await sessions.revoke(a.credential.token);
    await sessions.revoke(second.token);
  });

  it('rejects malformed input and unauthenticated or revoked sessions', async () => {
    const a = await sessions.create();
    const id = randomUUID();
    await expect(
      records.put(a.credential.token, `${id}\n`, 'review', Buffer.from('x'))
    ).rejects.toThrow('Invalid wallet record');
    await expect(
      records.put(a.credential.token, id, 'other' as never, Buffer.from('x'))
    ).rejects.toThrow('Invalid wallet record');
    await expect(records.put(a.credential.token, id, 'review', Buffer.alloc(0))).rejects.toThrow(
      'Invalid wallet record'
    );
    await expect(
      records.put(a.credential.token, id, 'review', Buffer.alloc(90001))
    ).rejects.toThrow('Invalid wallet record');
    expect(await records.get('invalid', id)).toEqual({ authenticated: false });
    expect(await records.put('invalid', id, 'review', Buffer.from('x'))).toEqual({
      authenticated: false
    });
    await sessions.revoke(a.credential.token);
    expect(await records.put(a.credential.token, id, 'review', Buffer.from('x'))).toEqual({
      authenticated: false
    });
    expect(await records.get(a.credential.token, id)).toEqual({ authenticated: false });
  });

  it('enforces envelope size and kind constraints even through raw SQL', async () => {
    const a = await sessions.create();
    for (const [kind, envelope] of [
      ['review', Buffer.alloc(0)],
      ['review', Buffer.alloc(90001)],
      ['other', Buffer.from('synthetic')]
    ] as const) {
      await expect(
        pool.query(
          `INSERT INTO wallet_owned_records (wallet_account_id, id, kind, envelope) VALUES ($1, $2, $3, $4)`,
          [a.walletAccountId, randomUUID(), kind, envelope]
        )
      ).rejects.toMatchObject({ code: '23514' });
    }
    await sessions.revoke(a.credential.token);
  });

  it('prevents runtime mutation or deletion even through raw SQL', async () => {
    const a = await sessions.create();
    const b = await sessions.create();
    const id = randomUUID();
    await records.put(a.credential.token, id, 'quarantine', Buffer.from('synthetic'));
    for (const sql of [
      'UPDATE wallet_owned_records SET wallet_account_id = $3 WHERE wallet_account_id = $1 AND id = $2',
      'UPDATE wallet_owned_records SET envelope = $3 WHERE wallet_account_id = $1 AND id = $2',
      'DELETE FROM wallet_owned_records WHERE wallet_account_id = $1 AND id = $2'
    ]) {
      const params = sql.includes('$3')
        ? [a.walletAccountId, id, b.walletAccountId]
        : [a.walletAccountId, id];
      await expect(pool.query(sql, params)).rejects.toMatchObject({ code: '42501' });
    }
    await sessions.revoke(a.credential.token);
    await sessions.revoke(b.credential.token);
  });

  it('freezes caller input before waiting on the session lock', async () => {
    const a = await sessions.create();
    const locker = await pool.connect();
    const id = randomUUID();
    const payload = Buffer.from('original synthetic');
    try {
      await locker.query('BEGIN');
      const pid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await locker.query('SELECT id FROM wallet_account_sessions WHERE id = $1 FOR UPDATE', [
        a.sessionId
      ]);
      const write = records.put(a.credential.token, id, 'transaction', payload);
      await waitUntilBlockedBy(pid);
      payload.fill(0);
      await locker.query('COMMIT');
      expect(await write).toEqual({ authenticated: true, value: 'created' });
      const result = await records.get(a.credential.token, id);
      if (!result.authenticated || !result.value) throw new Error('missing synthetic record');
      expect(result.value.envelope.toString()).toBe('original synthetic');
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
      await sessions.revoke(a.credential.token);
    }
  });

  it('allows a write that acquired the session lock to commit before logout', async () => {
    const a = await sessions.create();
    const id = randomUUID();
    const locker = await pool.connect();
    try {
      await locker.query('BEGIN');
      const blockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      // A synthetic conflicting insert blocks the real write after it holds the session lock.
      await locker.query(
        `INSERT INTO wallet_owned_records (wallet_account_id, id, kind, envelope)
        VALUES ($1, $2, 'candidate', $3)`,
        [a.walletAccountId, id, Buffer.from('rolled back')]
      );
      const write = records.put(a.credential.token, id, 'candidate', Buffer.from('synthetic'));
      await waitUntilBlockedBy(blockerPid);
      const blocked = await pool.query<{ pid: number }>(
        'SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
        [blockerPid]
      );
      expect(blocked.rows).toHaveLength(1);
      const logout = sessions.revoke(a.credential.token);
      await waitUntilBlockedBy(blocked.rows[0]!.pid);
      await locker.query('ROLLBACK');
      expect(await write).toEqual({ authenticated: true, value: 'created' });
      expect(await logout).toBe(true);
      const row = await pool.query<{ n: string }>(
        'SELECT count(*) AS n FROM wallet_owned_records WHERE wallet_account_id = $1 AND id = $2',
        [a.walletAccountId, id]
      );
      expect(row.rows[0]!.n).toBe('1');
      expect(await records.get(a.credential.token, id)).toEqual({ authenticated: false });
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
  });

  it('does not insert if revocation commits before a waiting write', async () => {
    const a = await sessions.create();
    const id = randomUUID();
    const locker = await pool.connect();
    try {
      await locker.query('BEGIN');
      const pid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await locker.query(
        'UPDATE wallet_account_sessions SET revoked_at = clock_timestamp() WHERE id = $1',
        [a.sessionId]
      );
      const write = records.put(a.credential.token, id, 'candidate', Buffer.from('synthetic'));
      await waitUntilBlockedBy(pid);
      await locker.query('COMMIT');
      expect(await write).toEqual({ authenticated: false });
      const row = await pool.query<{ n: string }>(
        'SELECT count(*) AS n FROM wallet_owned_records WHERE wallet_account_id = $1 AND id = $2',
        [a.walletAccountId, id]
      );
      expect(row.rows[0]!.n).toBe('0');
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
  });
});
