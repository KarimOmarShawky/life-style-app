import '../infrastructure-safety.js';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { streamAccountArchive } from '../../src/features/users/account-archive.js';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';

describe('account exports during retired financial data rollout', () => {
  it('excludes old financial and ingest records while preserving the v1 shape and unrelated records', async () => {
    const pool = getPgPool();
    const user = (
      await pool.query<{ id: string }>(
        `INSERT INTO users(email,password_hash,display_name,default_currency)
       VALUES($1,'fixture','Archive test','USD') RETURNING id`,
        [`${randomUUID()}@example.test`]
      )
    ).rows[0]!.id;
    try {
      const category = (
        await pool.query<{ id: string }>(
          `INSERT INTO categories(user_id,kind,name) VALUES($1,'expense','private-retired-category') RETURNING id`,
          [user]
        )
      ).rows[0]!.id;
      await pool.query(
        `INSERT INTO transactions(user_id,kind,amount,currency,occurred_on,category_id,description)
         VALUES($1,'expense',12,'USD','2026-01-01',$2,'private-retired-transaction')`,
        [user, category]
      );
      await pool.query(
        `INSERT INTO budgets(user_id,category_id,amount_limit,currency) VALUES($1,$2,100,'USD')`,
        [user, category]
      );
      const session = (
        await pool.query<{ id: string }>(
          `INSERT INTO auth_sessions(user_id,absolute_expires_at,device_platform)
         VALUES($1,now()+interval '1 day','android') RETURNING id`,
          [user]
        )
      ).rows[0]!.id;
      const ingest = (
        await pool.query<{ id: string }>(
          `INSERT INTO ingest_tokens(user_id,session_id,token_hash) VALUES($1,$2,$3) RETURNING id`,
          [user, session, Buffer.alloc(32, 7)]
        )
      ).rows[0]!.id;
      const subscription = (
        await pool.query<{ id: string }>(
          `INSERT INTO subscriptions(user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date)
         VALUES($1,'keep-subscription',12,'USD','month','2099-01-01','2099-02-01') RETURNING id`,
          [user]
        )
      ).rows[0]!.id;
      await pool.query(`INSERT INTO notes(user_id,title,body) VALUES($1,'keep-note','unrelated')`, [
        user
      ]);
      const lines: string[] = [];
      const stream = streamAccountArchive(pool, user, new AbortController().signal);
      let counts: Record<string, number> | undefined;
      try {
        while (true) {
          const result = await stream.next();
          if (result.done) {
            counts = result.value?.counts;
            break;
          }
          lines.push(result.value);
        }
      } finally {
        await stream.return(undefined);
      }
      for (const section of ['categories', 'transactions', 'budgets', 'ingestDevices']) {
        expect(counts?.[section]).toBe(0);
      }
      const text = lines.join('');
      expect(text).not.toContain('private-retired');
      expect(text).not.toContain(ingest);
      expect(text).toContain(subscription);
      expect(text).toContain('keep-note');
      const metadata = await new PgUsersRepository(pool).getUserExportData(user);
      expect(metadata.categories).toEqual([]);
      expect(metadata.profile.id).toBe(user);
    } finally {
      await pool.query('DELETE FROM transactions WHERE user_id=$1', [user]);
      await pool.query('DELETE FROM budgets WHERE user_id=$1', [user]);
      await pool.query('DELETE FROM subscriptions WHERE user_id=$1', [user]);
      await pool.query('DELETE FROM categories WHERE user_id=$1', [user]);
      await pool.query('DELETE FROM users WHERE id=$1', [user]);
    }
  });
});
