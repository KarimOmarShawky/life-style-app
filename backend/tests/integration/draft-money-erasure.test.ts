import '../infrastructure-safety.js';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

// Explicitly opt in: the draft locks and deletes ALL financial rows within a
// transaction. The outer rollback is mandatory, even on assertion failure.
const enabled = process.env.TEST_DRAFT_ERASURE === '1';
const require = createRequire(import.meta.url);
type DraftMigration = { up(pgm: { sql(statement: string): void }): void };
const draft =
  require('../../../docs/remediation/drafts/1792800000000_erase_retired_money.cjs') as DraftMigration & {
    down(): never;
  };
const notesIndexMigration =
  require('../../src/infrastructure/database/postgres/migrations/1792200000000_notes_body_trgm.cjs') as DraftMigration;
const resetRequestsMigration =
  require('../../src/infrastructure/database/postgres/migrations/1792300000000_password_reset_requests.cjs') as DraftMigration;
const resetOwnershipMigration =
  require('../../src/infrastructure/database/postgres/migrations/1792400000000_password_reset_ownership_and_fencing.cjs') as DraftMigration;
const amountScaleMigration =
  require('../../src/infrastructure/database/postgres/migrations/1792500000000_money_input_scale.cjs') as DraftMigration;
const walletAccountsMigration =
  require('../../src/infrastructure/database/postgres/migrations/1792600000000_wallet_account_sessions.cjs') as DraftMigration;
const walletRecordsMigration =
  require('../../src/infrastructure/database/postgres/migrations/1792700000000_wallet_owned_records.cjs') as DraftMigration;

describe.skipIf(!enabled)('draft financial erasure on isolated migrated PostgreSQL', () => {
  it('erases financial records for all accounts, retains subscriptions/reminders, revokes writes, and rolls back', async () => {
    const appUrl = new URL(process.env.DATABASE_URL!);
    const migratorUrl = new URL(process.env.DATABASE_MIGRATION_URL ?? 'invalid:');
    if (
      !['postgres:', 'postgresql:'].includes(migratorUrl.protocol) ||
      migratorUrl.hostname !== appUrl.hostname ||
      (migratorUrl.port || '5432') !== (appUrl.port || '5432') ||
      migratorUrl.pathname !== appUrl.pathname ||
      decodeURIComponent(migratorUrl.username) !== 'lifestyle_migrator' ||
      decodeURIComponent(appUrl.username) !== 'lifestyle_app'
    ) {
      throw new Error(
        'Draft erasure test requires the same isolated test DB and distinct test roles'
      );
    }
    const db = new Client({ connectionString: migratorUrl.toString() });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout = '5s'");
      // Fail if a future migration adds or changes an incoming reference. A new
      // foreign key may require another detachment or a different deletion order.
      const references = await db.query<{ child: string; parent: string; definition: string }>(`
        SELECT child.relname AS child, parent.relname AS parent, pg_get_constraintdef(fk.oid) AS definition
        FROM pg_constraint fk
        JOIN pg_class child ON child.oid = fk.conrelid
        JOIN pg_class parent ON parent.oid = fk.confrelid
        JOIN pg_namespace ns ON ns.oid = parent.relnamespace
        WHERE fk.contype = 'f' AND ns.nspname = 'public'
          AND parent.relname = ANY(ARRAY['categories','transactions','budgets','ingest_tokens',
            'wallet_accounts','wallet_account_sessions','wallet_owned_records'])
        ORDER BY parent.relname, child.relname, definition
      `);
      expect(references.rows).toEqual([
        {
          child: 'budgets',
          parent: 'categories',
          definition:
            'FOREIGN KEY (category_id, user_id, category_kind) REFERENCES categories(id, user_id, kind) ON DELETE RESTRICT'
        },
        {
          child: 'subscriptions',
          parent: 'categories',
          definition:
            'FOREIGN KEY (category_id, user_id, category_kind) REFERENCES categories(id, user_id, kind) ON DELETE RESTRICT'
        },
        {
          child: 'transactions',
          parent: 'categories',
          definition:
            'FOREIGN KEY (category_id, user_id, kind) REFERENCES categories(id, user_id, kind) ON DELETE RESTRICT'
        },
        {
          child: 'wallet_account_sessions',
          parent: 'wallet_accounts',
          definition: 'FOREIGN KEY (wallet_account_id) REFERENCES wallet_accounts(id)'
        },
        {
          child: 'wallet_owned_records',
          parent: 'wallet_accounts',
          definition: 'FOREIGN KEY (wallet_account_id) REFERENCES wallet_accounts(id)'
        }
      ]);
      const users: string[] = [];
      const subs: string[] = [];
      const reminders: string[] = [];
      for (let i = 0; i < 2; i++) {
        const user = await db.query<{ id: string }>(
          `INSERT INTO users(email,password_hash,display_name,default_currency)
           VALUES ($1,'fixture','Erasure fixture','USD') RETURNING id`,
          [`${randomUUID()}@example.test`]
        );
        const userId = user.rows[0]!.id;
        users.push(userId);
        const cat = await db.query<{ id: string }>(
          `INSERT INTO categories(user_id,kind,name) VALUES($1,'expense','Retired') RETURNING id`,
          [userId]
        );
        const categoryId = cat.rows[0]!.id;
        const subscription = await db.query<{ id: string }>(
          `INSERT INTO subscriptions(user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date,category_id,reminder_days_before)
           VALUES($1,'Keep subscription',12,'USD','month','2099-01-01','2099-02-01',$2,2) RETURNING id`,
          [userId, categoryId]
        );
        const subId = subscription.rows[0]!.id;
        subs.push(subId);
        const reminder = await db.query<{ id: string }>(
          `INSERT INTO reminders(user_id,subscription_id,source,remind_at,channel,next_attempt_at)
           VALUES($1,$2,'user','2099-01-30T09:00:00Z','in_app','2099-01-30T09:00:00Z') RETURNING id`,
          [userId, subId]
        );
        reminders.push(reminder.rows[0]!.id);
        await db.query(
          `INSERT INTO transactions(user_id,kind,amount,currency,occurred_on,category_id)
           VALUES($1,'expense',12,'USD','2026-01-01',$2)`,
          [userId, categoryId]
        );
        await db.query(
          `INSERT INTO budgets(user_id,category_id,amount_limit,currency) VALUES($1,$2,100,'USD')`,
          [userId, categoryId]
        );
        const session = await db.query<{ id: string }>(
          `INSERT INTO auth_sessions(user_id,absolute_expires_at,device_platform)
           VALUES($1,now()+interval '1 day','android') RETURNING id`,
          [userId]
        );
        await db.query(
          'INSERT INTO ingest_tokens(user_id,session_id,token_hash) VALUES($1,$2,$3)',
          [userId, session.rows[0]!.id, Buffer.alloc(32, i + 1)]
        );
        await db.query(`INSERT INTO notes(user_id,title,body) VALUES($1,'Keep note','unrelated')`, [
          userId
        ]);
      }
      const wallet = await db.query<{ id: string }>(
        'INSERT INTO wallet_accounts DEFAULT VALUES RETURNING id'
      );
      const walletId = wallet.rows[0]!.id;
      await db.query(
        `INSERT INTO wallet_account_sessions(wallet_account_id,token_hash,expires_at)
         VALUES($1,$2,now()+interval '1 day')`,
        [walletId, Buffer.alloc(32, 4)]
      );
      await db.query(
        `INSERT INTO wallet_owned_records(wallet_account_id,id,kind,envelope) VALUES($1,$2,'review',$3)`,
        [walletId, randomUUID(), Buffer.from('synthetic')]
      );
      await db.query(`INSERT INTO audit_logs(actor_type,event_type,outcome,entity_type,metadata)
        VALUES ('system','transaction.created','success','transaction','{"amount":"12"}'),
               ('system','subscription.paid','success','subscription','{}'),
               ('system','fixture.keep','success','note','{}')`);
      const beforeSubscriptions = await db.query(
        `SELECT id,name,amount,currency,billing_unit,anchor_date,next_billing_date,status,reminder_days_before,notes
         FROM subscriptions WHERE id=ANY($1::uuid[]) ORDER BY id`,
        [subs]
      );
      const beforeReminders = await db.query(
        'SELECT * FROM reminders WHERE id=ANY($1::uuid[]) ORDER BY id',
        [reminders]
      );
      const markerBefore = (
        await db.query<{ oid: string | null }>(
          `SELECT to_regclass('public.financial_retirement_state')::text AS oid`
        )
      ).rows[0]!.oid;
      const statements: string[] = [];
      draft.up({ sql: (statement) => statements.push(statement) });

      // Simulate the older catalog observed on Neon without touching that DB.
      // The current draft must not silently proceed when wallet tables are
      // absent: its exclusive lock fails and its transaction must be rolled back.
      await db.query('SAVEPOINT old_catalog');
      await db.query('DROP TABLE wallet_owned_records, wallet_account_sessions, wallet_accounts');
      await db.query('DROP TABLE password_reset_requests');
      await db.query('DROP INDEX idx_notes_body_trgm');
      await db.query('CREATE TABLE public.unrelated_erasure_test_fixture (id integer PRIMARY KEY)');
      await db.query('INSERT INTO public.unrelated_erasure_test_fixture VALUES (42)');
      for (const table of ['transactions', 'budgets', 'subscriptions']) {
        await db.query(`ALTER TABLE ${table} DROP COLUMN amount_scale`);
      }
      await db.query('SAVEPOINT before_old_catalog_draft');
      await expect(db.query(statements[0]!)).rejects.toMatchObject({ code: '42P01' });
      await db.query('ROLLBACK TO SAVEPOINT before_old_catalog_draft');
      expect(
        (
          await db.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM transactions WHERE user_id=ANY($1::uuid[])',
            [users]
          )
        ).rows[0]!.count
      ).toBe(2);
      expect(
        (await db.query('SELECT id FROM subscriptions WHERE id=ANY($1::uuid[])', [subs])).rowCount
      ).toBe(2);

      // REHEARSAL ONLY: with a separately provisioned restricted runtime role,
      // simulate selected missing objects in the supplied Neon catalog, plus
      // an unrelated table. This is not a full Neon clone or a role rehearsal.
      // It does not reconcile migration history, configure Neon roles, drain
      // old writers, validate backups, or approve production execution.
      await db.query('DROP FUNCTION public.wallet_session_revocation_is_final()');
      for (const migration of [
        notesIndexMigration,
        resetRequestsMigration,
        resetOwnershipMigration,
        amountScaleMigration,
        walletAccountsMigration,
        walletRecordsMigration,
        draft
      ]) {
        const bridgeStatements: string[] = [];
        migration.up({ sql: (statement) => bridgeStatements.push(statement) });
        for (const statement of bridgeStatements) await db.query(statement);
      }
      for (const table of ['transactions', 'budgets', 'categories', 'ingest_tokens']) {
        expect(
          (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n
        ).toBe(0);
      }
      expect(
        (
          await db.query(
            `SELECT id,name,amount,currency,billing_unit,anchor_date,next_billing_date,status,reminder_days_before,notes
             FROM subscriptions WHERE id=ANY($1::uuid[]) ORDER BY id`,
            [subs]
          )
        ).rows
      ).toEqual(beforeSubscriptions.rows);
      expect(
        (
          await db.query('SELECT * FROM reminders WHERE id=ANY($1::uuid[]) ORDER BY id', [
            reminders
          ])
        ).rows
      ).toEqual(beforeReminders.rows);
      expect(
        (
          await db.query('SELECT count(*)::int AS n FROM notes WHERE user_id=ANY($1::uuid[])', [
            users
          ])
        ).rows[0]!.n
      ).toBe(2);
      expect(
        (
          await db.query<{ allowed: boolean }>(
            `SELECT has_table_privilege('lifestyle_app','transactions','INSERT') AS allowed`
          )
        ).rows[0]!.allowed
      ).toBe(false);
      expect(
        (await db.query(`SELECT 1 FROM financial_retirement_state WHERE feature='legacy_money_v1'`))
          .rowCount
      ).toBe(1);
      expect((await db.query('SELECT id FROM public.unrelated_erasure_test_fixture')).rows).toEqual(
        [{ id: 42 }]
      );
      expect(
        (await db.query(`SELECT to_regclass('public.password_reset_requests') AS relation`))
          .rows[0]!.relation
      ).toBe('password_reset_requests');
      expect(
        (
          await db.query<{ allowed: boolean }>(
            `SELECT has_table_privilege('lifestyle_app','password_reset_requests','INSERT') AS allowed`
          )
        ).rows[0]!.allowed
      ).toBe(true);
      await db.query('ROLLBACK TO SAVEPOINT old_catalog');

      await db.query('SAVEPOINT before_erasure');
      for (const sql of statements) await db.query(sql);
      for (const table of [
        'transactions',
        'budgets',
        'categories',
        'ingest_tokens',
        'wallet_owned_records',
        'wallet_account_sessions',
        'wallet_accounts'
      ]) {
        const result = await db.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ${table}`
        );
        expect(result.rows[0]!.count, table).toBe(0);
      }
      expect(
        (
          await db.query(
            `SELECT id,name,amount,currency,billing_unit,anchor_date,next_billing_date,status,reminder_days_before,notes
         FROM subscriptions WHERE id=ANY($1::uuid[]) ORDER BY id`,
            [subs]
          )
        ).rows
      ).toEqual(beforeSubscriptions.rows);
      expect(
        (
          await db.query('SELECT * FROM reminders WHERE id=ANY($1::uuid[]) ORDER BY id', [
            reminders
          ])
        ).rows
      ).toEqual(beforeReminders.rows);
      expect(
        (
          await db.query('SELECT count(*)::int AS count FROM notes WHERE user_id=ANY($1::uuid[])', [
            users
          ])
        ).rows[0]!.count
      ).toBe(2);
      const audit = await db.query<{ event_type: string }>(
        `SELECT event_type FROM audit_logs WHERE event_type IN ('transaction.created','subscription.paid','fixture.keep')`
      );
      expect(audit.rows.map((row) => row.event_type)).toEqual(['fixture.keep']);
      for (const table of [
        'transactions',
        'budgets',
        'categories',
        'ingest_tokens',
        'wallet_owned_records',
        'wallet_account_sessions',
        'wallet_accounts'
      ]) {
        const result = await db.query<{ allowed: boolean }>(
          'SELECT has_table_privilege($1,$2,$3) AS allowed',
          ['lifestyle_app', table, 'INSERT']
        );
        expect(result.rows[0]!.allowed, table).toBe(false);
      }
      expect(
        (
          await db.query<{ allowed: boolean }>(
            `SELECT has_table_privilege('lifestyle_app','subscriptions','INSERT') AS allowed`
          )
        ).rows[0]!.allowed
      ).toBe(true);
      expect(() => draft.down()).toThrow(/irreversible/);
      expect(
        (
          await db.query(
            `SELECT feature FROM financial_retirement_state WHERE feature='legacy_money_v1'`
          )
        ).rowCount
      ).toBe(1);
      await db.query('ROLLBACK TO SAVEPOINT before_erasure');
      expect(
        (
          await db.query<{ oid: string | null }>(
            `SELECT to_regclass('public.financial_retirement_state')::text AS oid`
          )
        ).rows[0]!.oid
      ).toBe(markerBefore);
      expect(
        (
          await db.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM transactions WHERE user_id=ANY($1::uuid[])',
            [users]
          )
        ).rows[0]!.count
      ).toBe(2);
      expect(
        (
          await db.query<{ allowed: boolean }>(
            `SELECT has_table_privilege('lifestyle_app','transactions','INSERT') AS allowed`
          )
        ).rows[0]!.allowed
      ).toBe(true);

      // PUBLIC and inherited column grants survive a role-specific REVOKE. The
      // draft must abort rather than commit deletion while writes remain possible.
      for (const privilege of ['INSERT', 'UPDATE'] as const) {
        await db.query(`GRANT ${privilege} (name) ON categories TO PUBLIC`);
        await db.query('SAVEPOINT unexpected_grant');
        for (const sql of statements) {
          await expect(db.query(sql)).rejects.toThrow(/runtime retains (insert|update) access/);
        }
        await db.query('ROLLBACK TO SAVEPOINT unexpected_grant');
        expect(
          (
            await db.query<{ count: number }>(
              'SELECT count(*)::int AS count FROM transactions WHERE user_id=ANY($1::uuid[])',
              [users]
            )
          ).rows[0]!.count
        ).toBe(2);
        await db.query(`REVOKE ${privilege} (name) ON categories FROM PUBLIC`);
      }
      await db.query('GRANT UPDATE(token_hash) ON ingest_tokens TO PUBLIC');
      await db.query('SAVEPOINT unexpected_token_grant');
      for (const sql of statements) {
        await expect(db.query(sql)).rejects.toThrow(
          /runtime retains update access to ingest_tokens/
        );
      }
      await db.query('ROLLBACK TO SAVEPOINT unexpected_token_grant');
      expect(
        (
          await db.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM transactions WHERE user_id=ANY($1::uuid[])',
            [users]
          )
        ).rows[0]!.count
      ).toBe(2);
      await db.query('REVOKE UPDATE(token_hash) ON ingest_tokens FROM PUBLIC');
    } finally {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.end();
    }
  }, 30000);
});
