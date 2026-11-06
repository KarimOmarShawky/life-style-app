import '../infrastructure-safety.js';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';

// This test really COMMITS an irreversible, global erasure and changes grants.
// It must only ever run on a separate, freshly migrated disposable database.
const enabled = process.env.TEST_COMMITTED_DRAFT_ERASURE === '1';
const require = createRequire(import.meta.url);
const draft = require('../../../docs/remediation/drafts/1792800000000_erase_retired_money.cjs') as {
  up(pgm: { sql(statement: string): void }): void;
};

describe.skipIf(!enabled)(
  'committed erasure and concurrent writers in a disposable database',
  () => {
    it('orders in-flight writes before deletion and prevents a blocked writer from recreating data', async () => {
      const app = new URL(process.env.DATABASE_URL!);
      const migrator = new URL(process.env.DATABASE_MIGRATION_URL ?? 'invalid:');
      if (
        process.env.ERASURE_COMMIT_TEST_ACK !== 'destroy-disposable-erasure-test-only' ||
        !['postgres:', 'postgresql:'].includes(app.protocol) ||
        !['postgres:', 'postgresql:'].includes(migrator.protocol) ||
        !['localhost', '127.0.0.1'].includes(app.hostname) ||
        app.pathname !== '/lifestyle_test_erasure_commit' ||
        migrator.pathname !== app.pathname ||
        migrator.hostname !== app.hostname ||
        (migrator.port || '5432') !== (app.port || '5432') ||
        decodeURIComponent(app.username) !== 'lifestyle_app' ||
        decodeURIComponent(migrator.username) !== 'lifestyle_migrator'
      )
        throw new Error(
          'Committed erasure requires the dedicated disposable database and explicit acknowledgement'
        );

      const admin = new Client({ connectionString: migrator.toString() });
      const firstWriter = new Client({ connectionString: app.toString() });
      const lateWriter = new Client({ connectionString: app.toString() });
      await Promise.all([admin.connect(), firstWriter.connect(), lateWriter.connect()]);
      let erasure: Promise<unknown> | undefined;
      let lateInsert: Promise<unknown> | undefined;
      try {
        const identity = await admin.query<{ name: string; role: string; rolsuper: boolean }>(
          `SELECT current_database() AS name, current_user AS role, rolsuper FROM pg_roles WHERE rolname=current_user`
        );
        expect(identity.rows[0]).toEqual({
          name: 'lifestyle_test_erasure_commit',
          role: 'lifestyle_migrator',
          rolsuper: false
        });
        // Refuse to operate even on the named test DB if it contains pre-existing users or financial/audit rows.
        for (const table of [
          'users',
          'transactions',
          'budgets',
          'categories',
          'ingest_tokens',
          'wallet_owned_records',
          'wallet_account_sessions',
          'wallet_accounts',
          'audit_logs'
        ]) {
          const count = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
          if (count.rows[0]!.n !== 0)
            throw new Error(`Disposable erasure test database is not empty: ${table}`);
        }
        const user = (
          await admin.query<{ id: string }>(
            `INSERT INTO users(email,password_hash,display_name,default_currency) VALUES($1,'fixture','Keep','USD') RETURNING id`,
            [`${randomUUID()}@example.test`]
          )
        ).rows[0]!.id;
        const category = (
          await admin.query<{ id: string }>(
            `INSERT INTO categories(user_id,kind,name) VALUES($1,'expense','Retired') RETURNING id`,
            [user]
          )
        ).rows[0]!.id;
        const subscription = (
          await admin.query<{ id: string }>(
            `INSERT INTO subscriptions(user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date,category_id)
         VALUES($1,'Keep subscription',12,'USD','month','2099-01-01','2099-02-01',$2) RETURNING id`,
            [user, category]
          )
        ).rows[0]!.id;
        const reminder = (
          await admin.query<{ id: string }>(
            `INSERT INTO reminders(user_id,subscription_id,source,remind_at,channel,next_attempt_at)
         VALUES($1,$2,'user','2099-01-30T09:00Z','in_app','2099-01-30T09:00Z') RETURNING id`,
            [user, subscription]
          )
        ).rows[0]!.id;
        await admin.query(
          `INSERT INTO notes(user_id,title,body) VALUES($1,'Keep note','unrelated')`,
          [user]
        );
        const otherUser = (
          await admin.query<{ id: string }>(
            `INSERT INTO users(email,password_hash,display_name,default_currency) VALUES($1,'fixture','Other','USD') RETURNING id`,
            [`${randomUUID()}@example.test`]
          )
        ).rows[0]!.id;
        const otherSubscription = (
          await admin.query<{ id: string }>(
            `INSERT INTO subscriptions(user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date)
             VALUES($1,'Other subscription',12,'USD','month','2099-01-01','2099-02-01') RETURNING id`,
            [otherUser]
          )
        ).rows[0]!.id;

        await firstWriter.query('BEGIN');
        await firstWriter.query(
          `INSERT INTO transactions(user_id,kind,amount,currency,occurred_on) VALUES($1,'expense',10,'USD','2026-01-01')`,
          [user]
        );
        await admin.query('BEGIN');
        await admin.query("SET LOCAL lock_timeout = '10s'");
        const adminPid = (await admin.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        const firstPid = (
          await firstWriter.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
        ).rows[0]!.pid;
        const latePid = (await lateWriter.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        const statements: string[] = [];
        draft.up({ sql: (sql) => statements.push(sql) });
        erasure = (async () => {
          for (const sql of statements) await admin.query(sql);
        })();
        void erasure.catch(() => undefined);
        const blockedBy = async (pid: number, blocker: number) => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const result = await lateWriter.query<{ blocked: boolean }>(
              `SELECT $2 = ANY(pg_blocking_pids($1)) AS blocked`,
              [pid, blocker]
            );
            if (result.rows[0]!.blocked) return true;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return false;
        };
        expect(await blockedBy(adminPid, firstPid)).toBe(true);
        await firstWriter.query('COMMIT');
        await erasure;

        // The late writer begins while erasure holds its exclusive lock. PostgreSQL
        // must enforce the revoked privilege after the lock is released as well.
        await lateWriter.query("SET statement_timeout = '10s'");
        lateInsert = lateWriter.query(
          `INSERT INTO transactions(user_id,kind,amount,currency,occurred_on) VALUES($1,'expense',20,'USD','2026-01-01')`,
          [user]
        );
        void lateInsert.catch(() => undefined);
        // Use firstWriter for observing, since lateWriter is busy with the insert.
        const deadline = Date.now() + 5000;
        let blocked = false;
        while (Date.now() < deadline && !blocked) {
          blocked = (
            await firstWriter.query<{ blocked: boolean }>(
              'SELECT $2 = ANY(pg_blocking_pids($1)) AS blocked',
              [latePid, adminPid]
            )
          ).rows[0]!.blocked;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        await admin.query('COMMIT');
        await expect(lateInsert).rejects.toMatchObject({ code: '42501' });
        lateInsert = undefined;
        expect((await admin.query('SELECT count(*)::int AS n FROM transactions')).rows[0].n).toBe(
          0
        );
        expect(
          (
            await admin.query('SELECT name,category_id FROM subscriptions WHERE id=$1', [
              subscription
            ])
          ).rows[0]
        ).toEqual({ name: 'Keep subscription', category_id: null });
        expect(
          (await admin.query('SELECT count(*)::int AS n FROM reminders WHERE id=$1', [reminder]))
            .rows[0].n
        ).toBe(1);
        expect(
          (await admin.query('SELECT count(*)::int AS n FROM notes WHERE user_id=$1', [user]))
            .rows[0].n
        ).toBe(1);

        // Normal account lifecycle must continue under the restricted runtime
        // role after erasure, without affecting another account's subscription.
        const runtimePool = new Pool({ connectionString: app.toString() });
        try {
          const users = new PgUsersRepository(runtimePool);
          await users.scheduleDeletion(user, new Date(Date.now() - 1000));
          expect(await users.purgeAccount(user)).toBe(true);
          expect(await users.purgeAccount(user)).toBe(false);
          expect((await admin.query('SELECT id FROM users WHERE id=$1', [user])).rowCount).toBe(0);
          expect(
            (
              await admin.query('SELECT id FROM subscriptions WHERE id=$1 AND user_id=$2', [
                otherSubscription,
                otherUser
              ])
            ).rowCount
          ).toBe(1);
        } finally {
          await runtimePool.end();
        }
      } finally {
        await firstWriter.query('ROLLBACK').catch(() => undefined);
        await admin.query('ROLLBACK').catch(() => undefined);
        await erasure?.catch(() => undefined);
        await lateInsert?.catch(() => undefined);
        await Promise.all([admin.end(), firstWriter.end(), lateWriter.end()]);
      }
    }, 30000);
  }
);
