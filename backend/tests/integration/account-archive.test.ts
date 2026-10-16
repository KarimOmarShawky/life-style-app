import '../infrastructure-safety.js';
// Authored live-PostgreSQL tests. NOT covered by SQL-harness/unit results.
import { randomUUID, createHash } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPgPool, closePgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { streamAccountArchive } from '../../src/features/users/account-archive.js';
import { ACCOUNT_ARCHIVE_SOURCES } from '../../src/features/users/account-archive.sources.js';

describe('Domain archive PostgreSQL snapshot, grants and tenancy', () => {
  const pool = getPgPool();
  let userA: string, userB: string;
  const owned: string[] = [];
  beforeEach(async () => {
    for (let i = 0; i < 2; i++) {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO users
        (email, password_hash, display_name, default_currency)
        VALUES ($1, 'nonusable-test-hash', 'Archive fixture', 'KWD') RETURNING id`,
        [`${randomUUID()}@example.test`]
      );
      owned.push(result.rows[0]!.id);
    }
    [userA, userB] = owned.slice(-2) as [string, string];
    await pool.query(
      `INSERT INTO notes (user_id, title, body, deleted_at)
      VALUES ($1, 'Own archived note', 'owned personal text', now()), ($2, 'Other account', 'other-account-private-text', NULL)`,
      [userA, userB]
    );
    await pool.query(
      `INSERT INTO transactions (user_id, kind, amount, currency, occurred_on)
      VALUES ($1, 'expense', '900719925474099.1234', 'KWD', '2026-10-15')`,
      [userA]
    );
  });
  afterEach(async () => {
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [owned.splice(0)]);
  });
  afterAll(closePgPool);

  it('executes every explicit projection with runtime grants; preserves decimals and excludes other users/security material', async () => {
    const role = await pool.query<{ current_user: string; rolsuper: boolean }>(
      `SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user`
    );
    expect(role.rows[0]).toEqual({ current_user: 'lifestyle_app', rolsuper: false });
    const stream = streamAccountArchive(pool, userA, new AbortController().signal),
      lines: string[] = [];
    try {
      while (true) {
        const frame = await stream.next();
        if (frame.done) {
          expect(Object.keys(frame.value!.counts).sort()).toEqual(
            ACCOUNT_ARCHIVE_SOURCES.map((s) => s.section).sort()
          );
          expect(frame.value!.sha256).toBe(
            createHash('sha256').update(lines.join('')).digest('hex')
          );
          break;
        }
        lines.push(frame.value);
      }
    } finally {
      await stream.return(undefined);
    }
    const records = lines.map((line) => JSON.parse(line));
    expect(records.find((row) => row.section === 'transactions').data.amount).toBe(
      '900719925474099.1234'
    );
    expect(records.find((row) => row.section === 'notes').data.deleted_at).not.toBeNull();
    expect(lines.join('')).not.toMatch(
      /other-account-private-text|nonusable-test-hash|"password_hash"|"push_token"|"token_hash"/
    );
  });

  it('keeps one snapshot across tables even when another connection commits a new note', async () => {
    const stream = streamAccountArchive(pool, userA, new AbortController().signal),
      lines: string[] = [];
    try {
      const first = await stream.next();
      expect(first.done).toBe(false);
      await pool.query(
        `INSERT INTO notes (user_id, body) VALUES ($1, 'committed-after-snapshot')`,
        [userA]
      );
      for await (const line of stream) lines.push(line);
      expect(lines.join('')).not.toContain('committed-after-snapshot');
    } finally {
      await stream.return(undefined);
    }
    const next: string[] = [];
    for await (const line of streamAccountArchive(pool, userA, new AbortController().signal))
      next.push(line);
    expect(next.join('')).toContain('committed-after-snapshot');
  });
});
