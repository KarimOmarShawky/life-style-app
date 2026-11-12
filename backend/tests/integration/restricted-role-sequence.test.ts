import '../infrastructure-safety.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runner as runMigrations } from 'node-pg-migrate';
import { Client, Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { assertFinancialRetirement } from '../../src/infrastructure/database/postgres/financial-retirement-guard.js';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';
import { PgAiReportsRepository } from '../../src/features/ai-reports/ai-reports.repository.pg.js';
import { PgAiSettingsRepository } from '../../src/features/ai-settings/ai-settings.repository.pg.js';
import {
  PgSessionsRepository,
  resetSessionRevokeReasonCache
} from '../../src/features/sessions/sessions.repository.pg.js';

// REHEARSAL ONLY. This test creates cluster-wide roles and changes ownership
// in its own empty database. The PostgreSQL INSTANCE itself must be disposable.
// It is not a migration, a Neon replica, or an approved production procedure.
const enabled = process.env.TEST_RESTRICTED_ROLE_SEQUENCE === '1';
const require = createRequire(import.meta.url);
type Migration = { up(pgm: { sql(statement: string): void }): void };
const migrations = [
  '1792200000000_notes_body_trgm.cjs',
  '1792300000000_password_reset_requests.cjs',
  '1792400000000_password_reset_ownership_and_fencing.cjs',
  '1792500000000_money_input_scale.cjs'
].map(
  (name) => require(`../../src/infrastructure/database/postgres/migrations/${name}`) as Migration
);
const walletMigrations = [
  '1792600000000_wallet_account_sessions.cjs',
  '1792700000000_wallet_owned_records.cjs'
].map(
  (name) => require(`../../src/infrastructure/database/postgres/migrations/${name}`) as Migration
);
const erasure =
  require('../../../docs/remediation/drafts/1792800000000_erase_retired_money.cjs') as Migration;
const grants =
  require('../../../docs/remediation/drafts/1792900000000_runtime_grants_rehearsal.cjs') as Migration;

async function execute(client: Client, migration: Migration): Promise<void> {
  const statements: string[] = [];
  migration.up({ sql: (sql) => statements.push(sql) });
  for (const statement of statements) await client.query(statement);
}

describe.skipIf(!enabled)('isolated restricted-role sequencing experiment', () => {
  it('rehearses schema additions before a fresh role, then atomic erasure and scoped grants', async () => {
    const adminUrl = new URL(process.env.ROLE_REHEARSAL_ADMIN_URL ?? 'invalid:');
    const appUrl = new URL(process.env.DATABASE_URL ?? 'invalid:');
    const ownerUrl = new URL(process.env.DATABASE_MIGRATION_URL ?? 'invalid:');
    if (
      process.env.ROLE_REHEARSAL_ACK !== 'dedicated-disposable-postgres-instance-only' ||
      !['postgres:', 'postgresql:'].includes(adminUrl.protocol) ||
      !['localhost', '127.0.0.1'].includes(adminUrl.hostname) ||
      adminUrl.pathname !== '/lifestyle_test_role_rehearsal' ||
      !['5433', '16975'].includes(adminUrl.port) ||
      [adminUrl, appUrl, ownerUrl].some((url) => url.search !== '' || url.password !== '') ||
      decodeURIComponent(adminUrl.username) !== 'postgres' ||
      [appUrl, ownerUrl].some(
        (url) =>
          !['postgres:', 'postgresql:'].includes(url.protocol) ||
          url.hostname !== adminUrl.hostname ||
          (url.port || '5432') !== (adminUrl.port || '5432') ||
          url.pathname !== adminUrl.pathname
      ) ||
      decodeURIComponent(appUrl.username) !== 'lifestyle_app' ||
      decodeURIComponent(ownerUrl.username) !== 'lifestyle_rehearsal_owner'
    )
      throw new Error(
        'This test requires a dedicated disposable PostgreSQL instance and explicit acknowledgement'
      );

    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    try {
      const identity = await admin.query<{ db: string; is_super: boolean }>(
        `SELECT current_database() AS db, rolsuper AS is_super FROM pg_roles WHERE rolname=current_user`
      );
      expect(identity.rows[0]).toEqual({ db: 'lifestyle_test_role_rehearsal', is_super: true });
      const existingRoles = await admin.query(
        `SELECT 1 FROM pg_roles WHERE rolname <> 'postgres' AND left(rolname, 3) <> 'pg_'`
      );
      const databases = await admin.query<{ datname: string }>(
        `SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname`
      );
      const existingObjects = await admin.query(`
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
        UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
        UNION ALL SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND left(nspname,3) <> 'pg_'
        UNION ALL SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql' LIMIT 1
      `);
      if (
        existingRoles.rowCount ||
        existingObjects.rowCount ||
        JSON.stringify(databases.rows.map((row) => row.datname)) !==
          JSON.stringify(['lifestyle_test_role_rehearsal', 'postgres'])
      )
        throw new Error('Rehearsal instance is not fresh');

      // This bootstrap is exclusively for the empty local fixture. It does
      // not change any existing role, its password, or a real database owner.
      await admin.query(
        'CREATE ROLE lifestyle_rehearsal_owner LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS'
      );
      await admin.query(
        'ALTER DATABASE lifestyle_test_role_rehearsal OWNER TO lifestyle_rehearsal_owner'
      );
      await admin.query('ALTER SCHEMA public OWNER TO lifestyle_rehearsal_owner');
      const owner = new Client({ connectionString: ownerUrl.toString() });
      await owner.connect();
      try {
        // Apply the repo schema only as a synthetic base with no runtime role;
        // remove the catalog objects observed absent. This is not a Neon copy.
        const schema = await readFile(new URL('../../../schema.sql', import.meta.url), 'utf8');
        await owner.query(schema);
        await owner.query(
          'DROP TABLE wallet_owned_records, wallet_account_sessions, wallet_accounts, password_reset_requests, product_events, notification_preferences, ai_content_reports, ai_user_settings'
        );
        // Production has not received the owner-run product-events/onboarding
        // DDL (feature guide G5/G1) yet; it is applied at the end below.
        await owner.query(
          'ALTER TABLE users DROP COLUMN product_events_enabled, DROP COLUMN onboarding_completed_at'
        );
        // Nor the owner-run G6 SQL: restore the session reason list without
        // 'user_revoked'; the file is applied at the end below.
        await owner.query(
          `ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_revoked_reason_check;
           ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_revoked_reason_check CHECK (revoked_reason IN (
             'logout', 'logout_all', 'password_change', 'password_reset',
             'reuse_detected', 'account_disabled', 'account_deletion'))`
        );
        await owner.query('DROP FUNCTION wallet_session_revocation_is_final()');
        await owner.query('DROP INDEX idx_notes_body_trgm');
        for (const table of ['transactions', 'budgets', 'subscriptions'])
          await owner.query(`ALTER TABLE ${table} DROP COLUMN amount_scale`);
        await owner.query('CREATE TABLE playing_with_neon_fixture (id integer PRIMARY KEY)');
        await owner.query('INSERT INTO playing_with_neon_fixture VALUES (42)');

        const user = (
          await owner.query<{ id: string }>(
            `INSERT INTO users(email,password_hash,display_name,default_currency) VALUES($1,'fixture','Keep','USD') RETURNING id`,
            [`${randomUUID()}@example.test`]
          )
        ).rows[0]!.id;
        const category = (
          await owner.query<{ id: string }>(
            `INSERT INTO categories(user_id,kind,name) VALUES($1,'expense','Retired') RETURNING id`,
            [user]
          )
        ).rows[0]!.id;
        const sub = (
          await owner.query<{ id: string }>(
            `INSERT INTO subscriptions(user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date,category_id) VALUES($1,'Keep',12,'USD','month','2099-01-01','2099-02-01',$2) RETURNING id`,
            [user, category]
          )
        ).rows[0]!.id;
        const otherUser = (
          await owner.query<{ id: string }>(
            `INSERT INTO users(email,password_hash,display_name,default_currency) VALUES($1,'fixture','Other','USD') RETURNING id`,
            [`${randomUUID()}@example.test`]
          )
        ).rows[0]!.id;
        const otherSub = (
          await owner.query<{ id: string }>(
            `INSERT INTO subscriptions(user_id,name,amount,currency,billing_unit,anchor_date,next_billing_date) VALUES($1,'Other keep',20,'USD','month','2099-01-01','2099-02-01') RETURNING id`,
            [otherUser]
          )
        ).rows[0]!.id;
        await owner.query(
          `INSERT INTO reminders(user_id,subscription_id,source,remind_at,channel,next_attempt_at) VALUES($1,$2,'user','2099-01-30T09:00Z','in_app','2099-01-30T09:00Z')`,
          [user, sub]
        );
        await owner.query(`INSERT INTO notes(user_id,title,body) VALUES($1,'Keep','synthetic')`, [
          user
        ]);
        await owner.query(
          `INSERT INTO transactions(user_id,kind,amount,currency,occurred_on,category_id) VALUES($1,'expense',10,'USD','2026-01-01',$2)`,
          [user, category]
        );
        await owner.query(
          `INSERT INTO budgets(user_id,category_id,amount_limit,currency) VALUES($1,$2,100,'USD')`,
          [user, category]
        );
        const session = (
          await owner.query<{ id: string }>(
            `INSERT INTO auth_sessions(user_id,absolute_expires_at,device_platform) VALUES($1,now()+interval '1 day','android') RETURNING id`,
            [user]
          )
        ).rows[0]!.id;
        await owner.query(
          'INSERT INTO ingest_tokens(user_id,session_id,token_hash) VALUES($1,$2,$3)',
          [user, session, Buffer.alloc(32, 1)]
        );
        await owner.query(
          `INSERT INTO audit_logs(actor_type,event_type,outcome,entity_type) VALUES ('system','transaction.created','success','transaction'),('system','fixture.keep','success',NULL)`
        );

        // The migration CLI's --dry-run is NOT read-only on a database with
        // no migration ledger: its runner creates the ledger before simulating
        // migrations. Demonstrate only on this disposable instance, then remove
        // the synthetic ledger so the remainder models the observed old schema.
        expect(
          (await owner.query(`SELECT to_regclass('public.pgmigrations') AS name`)).rows[0]!.name
        ).toBeNull();
        const pending = await runMigrations({
          databaseUrl: ownerUrl.toString(),
          dir: fileURLToPath(
            new URL('../../src/infrastructure/database/postgres/migrations/', import.meta.url)
          ),
          direction: 'up',
          migrationsTable: 'pgmigrations',
          dryRun: true,
          singleTransaction: true,
          logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
        });
        expect(pending.length).toBeGreaterThan(0);
        expect(
          (await owner.query(`SELECT to_regclass('public.pgmigrations') AS name`)).rows[0]!.name
        ).toBe('pgmigrations');
        expect((await owner.query('SELECT count(*)::int AS n FROM pgmigrations')).rows[0]!.n).toBe(
          0
        );
        expect((await owner.query('SELECT count(*)::int AS n FROM transactions')).rows[0]!.n).toBe(
          1
        );
        await owner.query('DROP TABLE public.pgmigrations');

        // The inventory is a single read-only catalog query. Exercise it with
        // the role absent, then with deliberately risky synthetic privileges,
        // and ensure customer data and function bodies never appear in output.
        const inventory = await readFile(
          new URL(
            '../../../docs/remediation/drafts/security-inventory-readonly.sql',
            import.meta.url
          ),
          'utf8'
        );
        await owner.query('BEGIN READ ONLY');
        const absentInventory = await owner.query<{
          kind: string;
          object: string;
          detail: Record<string, unknown>;
        }>(inventory);
        expect(
          absentInventory.rows.find((row) => row.kind === 'environment')!.detail.runtime_role_exists
        ).toBe(false);
        await owner.query('ROLLBACK');
        await owner.query('BEGIN');
        await owner.query('CREATE SCHEMA security_fixture');
        await owner.query(
          `CREATE TABLE security_fixture.external_reference (id uuid, user_id uuid, payload text, FOREIGN KEY(id,user_id) REFERENCES public.categories(id,user_id))`
        );
        await owner.query(`CREATE TABLE security_fixture.private_rows (payload text)`);
        await owner.query(
          `INSERT INTO security_fixture.private_rows VALUES ('fixture_customer_data_not_to_export')`
        );
        await owner.query(
          `CREATE FUNCTION security_fixture.test_definer() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'fixture_function_body_not_to_export'::text $$`
        );
        await owner.query('GRANT UPDATE(name) ON categories TO PUBLIC');
        await owner.query(
          'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC'
        );
        await owner.query(
          `ALTER ROLE lifestyle_rehearsal_owner SET application_name = 'fixture_setting_value_not_to_export'`
        );
        const riskInventory = await owner.query<{
          kind: string;
          object: string;
          detail: Record<string, unknown>;
        }>(inventory);
        expect(
          riskInventory.rows.some(
            (row) =>
              row.kind === 'column_acl' &&
              row.detail.column === 'name' &&
              row.detail.grantee === 'PUBLIC' &&
              row.detail.privilege === 'UPDATE'
          )
        ).toBe(true);
        expect(
          riskInventory.rows.some(
            (row) =>
              row.kind === 'default_acl' &&
              row.detail.grantee === 'PUBLIC' &&
              row.detail.privilege === 'SELECT'
          )
        ).toBe(true);
        expect(
          riskInventory.rows.some(
            (row) =>
              row.kind === 'security_definer' &&
              row.detail.name === 'test_definer' &&
              row.detail.public_execute === true
          )
        ).toBe(true);
        expect(
          riskInventory.rows.some(
            (row) =>
              row.kind === 'function_acl' &&
              row.detail.name === 'test_definer' &&
              row.detail.grantee === 'PUBLIC' &&
              row.detail.privilege === 'EXECUTE'
          )
        ).toBe(true);
        expect(
          riskInventory.rows.some(
            (row) => row.kind === 'incoming_fk' && row.detail.child_schema === 'security_fixture'
          )
        ).toBe(true);
        expect(
          riskInventory.rows.some(
            (row) => row.kind === 'role_setting' && row.detail.setting_name === 'application_name'
          )
        ).toBe(true);
        const serializedInventory = JSON.stringify(riskInventory.rows);
        expect(serializedInventory).not.toContain('fixture_customer_data_not_to_export');
        expect(serializedInventory).not.toContain('fixture_function_body_not_to_export');
        expect(serializedInventory).not.toContain('fixture_setting_value_not_to_export');
        await owner.query('ROLLBACK');

        await owner.query('BEGIN');
        await owner.query("SET LOCAL lock_timeout = '5s'");
        // Compatibility additions are applied while the runtime role is absent,
        // so their conditional grants cannot create broad runtime access.
        const prepare = async () => {
          for (const migration of migrations) await execute(owner, migration);
          await owner.query(
            'CREATE ROLE lifestyle_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
          );
          for (const migration of walletMigrations) await execute(owner, migration);
        };
        // Fail closed on unexpected PUBLIC access. Roll back the entire
        // attempted sequence, including role creation and schema additions.
        await owner.query('SAVEPOINT blocked');
        await prepare();
        await owner.query('GRANT SELECT ON playing_with_neon_fixture TO PUBLIC');
        await execute(owner, erasure);
        await expect(execute(owner, grants)).rejects.toThrow(/not fresh/);
        await owner.query('ROLLBACK TO SAVEPOINT blocked');
        expect(
          (await owner.query(`SELECT 1 FROM pg_roles WHERE rolname='lifestyle_app'`)).rowCount
        ).toBe(0);
        expect(
          (await owner.query(`SELECT to_regclass('public.password_reset_requests') AS name`))
            .rows[0]!.name
        ).toBeNull();
        expect(
          (await owner.query(`SELECT to_regclass('public.wallet_accounts') AS name`)).rows[0]!.name
        ).toBeNull();
        expect((await owner.query('SELECT count(*)::int AS n FROM transactions')).rows[0]!.n).toBe(
          1
        );
        expect(
          (await owner.query(`SELECT to_regclass('public.financial_retirement_state') AS name`))
            .rows[0]!.name
        ).toBeNull();
        expect(
          (await owner.query('SELECT category_id FROM subscriptions WHERE id=$1', [sub])).rows[0]!
            .category_id
        ).toBe(category);
        const serverVersion = Number(
          (
            await owner.query<{ version: string }>(
              `SELECT current_setting('server_version_num') AS version`
            )
          ).rows[0]!.version
        );
        if (serverVersion >= 170000) {
          await owner.query('SAVEPOINT blocked_maintain');
          await prepare();
          await owner.query('GRANT MAINTAIN ON categories TO PUBLIC');
          await execute(owner, erasure);
          await expect(execute(owner, grants)).rejects.toThrow(/MAINTAIN/);
          await owner.query('ROLLBACK TO SAVEPOINT blocked_maintain');
          expect(
            (await owner.query(`SELECT 1 FROM pg_roles WHERE rolname='lifestyle_app'`)).rowCount
          ).toBe(0);
          expect(
            (await owner.query('SELECT count(*)::int AS n FROM transactions')).rows[0]!.n
          ).toBe(1);
        }
        await prepare();
        await execute(owner, erasure);
        await execute(owner, grants);
        await owner.query('COMMIT');
        await owner.query('BEGIN READ ONLY');
        const liveInventory = await owner.query<{
          kind: string;
          object: string;
          detail: Record<string, unknown>;
        }>(inventory);
        expect(
          liveInventory.rows.find((row) => row.kind === 'environment')!.detail.runtime_role_exists
        ).toBe(true);
        const runtimeTransactionRights = liveInventory.rows.find(
          (row) =>
            row.kind === 'target_effective' &&
            row.detail.name === 'transactions' &&
            row.detail.role === 'lifestyle_app'
        )!.detail;
        expect(runtimeTransactionRights.table_insert).toBe(false);
        expect(runtimeTransactionRights.column_update).toBe(false);
        await owner.query('ROLLBACK');

        for (const table of [
          'transactions',
          'budgets',
          'categories',
          'ingest_tokens',
          'wallet_accounts',
          'wallet_account_sessions',
          'wallet_owned_records'
        ]) {
          expect((await owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n).toBe(0);
        }
        expect(
          (await owner.query('SELECT id,category_id FROM subscriptions WHERE id=$1', [sub])).rows[0]
        ).toEqual({ id: sub, category_id: null });
        expect(
          (
            await owner.query('SELECT count(*)::int AS n FROM reminders WHERE subscription_id=$1', [
              sub
            ])
          ).rows[0]!.n
        ).toBe(1);
        expect(
          (await owner.query('SELECT count(*)::int AS n FROM notes WHERE user_id=$1', [user]))
            .rows[0]!.n
        ).toBe(1);
        expect((await owner.query('SELECT id FROM playing_with_neon_fixture')).rows).toEqual([
          { id: 42 }
        ]);
        expect((await owner.query('SELECT event_type FROM audit_logs')).rows).toEqual([
          { event_type: 'fixture.keep' }
        ]);

        const runtime = new Pool({ connectionString: appUrl.toString() });
        try {
          await expect(assertFinancialRetirement(runtime, true)).resolves.toBeUndefined();
          await expect(
            runtime.query('SELECT * FROM playing_with_neon_fixture')
          ).rejects.toMatchObject({ code: '42501' });
          for (const table of [
            'transactions',
            'budgets',
            'categories',
            'ingest_tokens',
            'wallet_accounts',
            'wallet_account_sessions',
            'wallet_owned_records'
          ]) {
            await expect(
              runtime.query(`INSERT INTO ${table} DEFAULT VALUES`)
            ).rejects.toMatchObject({ code: '42501' });
            await expect(
              runtime.query(`UPDATE ${table} SET id=id WHERE false`)
            ).rejects.toMatchObject({ code: '42501' });
          }
          await runtime.query('UPDATE ingest_tokens SET revoked_at=now() WHERE false');
          await runtime.query(
            `INSERT INTO notes(user_id,title,body) VALUES($1,'Runtime','synthetic')`,
            [user]
          );
          const users = new PgUsersRepository(runtime);
          await users.scheduleDeletion(user, new Date(Date.now() - 1000));
          expect(await users.purgeAccount(user)).toBe(true);
          expect(
            (
              await runtime.query('SELECT id FROM subscriptions WHERE user_id=$1 AND id=$2', [
                otherUser,
                otherSub
              ])
            ).rowCount
          ).toBe(1);
          expect((await owner.query('SELECT id FROM playing_with_neon_fixture')).rows).toEqual([
            { id: 42 }
          ]);

          // Feature guide G5/G1: the owner-run SQL file, applied after the
          // restricted runtime role exists (the production order), adds the
          // table and columns and grants the runtime exactly what code needs.
          const productEventsSql = await readFile(
            new URL(
              '../../../docs/analytics/sql/product-events-and-onboarding.sql',
              import.meta.url
            ),
            'utf8'
          );
          await owner.query(productEventsSql);
          const can = async (privilege: string) =>
            (
              await owner.query<{ ok: boolean }>(
                `SELECT has_table_privilege('lifestyle_app', 'public.product_events', $1) AS ok`,
                [privilege]
              )
            ).rows[0]!.ok;
          expect(await can('SELECT')).toBe(true);
          expect(await can('INSERT')).toBe(true);
          expect(await can('DELETE')).toBe(true);
          expect(await can('UPDATE')).toBe(false);
          expect(await can('TRUNCATE')).toBe(false);
          await expect(owner.query(productEventsSql)).rejects.toMatchObject({ code: '42P07' });
          await owner.query('ROLLBACK');
          expect(
            (
              await runtime.query<{ done: Date | null }>(
                'UPDATE users SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()) WHERE id = $1 RETURNING onboarding_completed_at AS done',
                [otherUser]
              )
            ).rows[0]!.done
          ).toBeInstanceOf(Date);
          await runtime.query(
            `INSERT INTO product_events (user_id, event_name, occurred_on, platform) VALUES ($1, 'app_opened', CURRENT_DATE, 'android')`,
            [otherUser]
          );
          await expect(
            runtime.query(`UPDATE product_events SET platform = 'ios'`)
          ).rejects.toMatchObject({ code: '42501' });
          await users.scheduleDeletion(otherUser, new Date(Date.now() - 1000));
          expect(await users.purgeAccount(otherUser)).toBe(true);
          expect(
            (await owner.query('SELECT count(*)::int AS n FROM product_events')).rows[0]!.n
          ).toBe(0);

          // Feature guide G2: the owner-run notification-preferences SQL, also
          // applied after the restricted runtime role exists.
          const preferencesSql = await readFile(
            new URL(
              '../../../docs/notifications/sql/notification-preferences.sql',
              import.meta.url
            ),
            'utf8'
          );
          await owner.query(preferencesSql);
          const canPrefs = async (privilege: string) =>
            (
              await owner.query<{ ok: boolean }>(
                `SELECT has_table_privilege('lifestyle_app', 'public.notification_preferences', $1) AS ok`,
                [privilege]
              )
            ).rows[0]!.ok;
          for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
            expect(await canPrefs(privilege)).toBe(true);
          }
          expect(await canPrefs('TRUNCATE')).toBe(false);
          await expect(owner.query(preferencesSql)).rejects.toMatchObject({ code: '42P07' });
          await owner.query('ROLLBACK');
          const prefsUser = (
            await owner.query<{ id: string }>(
              `INSERT INTO users (email, password_hash, display_name, timezone, default_currency)
               VALUES ('prefs-role@example.com', 'x', 'Prefs', 'UTC', 'USD') RETURNING id`
            )
          ).rows[0]!.id;
          await runtime.query(
            `INSERT INTO notification_preferences (user_id, quiet_start_minute, quiet_end_minute)
             VALUES ($1, 1320, 420)
             ON CONFLICT (user_id) DO UPDATE SET daily_cap = 3`,
            [prefsUser]
          );
          await runtime.query(
            'UPDATE notification_preferences SET daily_cap = 5 WHERE user_id = $1',
            [prefsUser]
          );
          await users.scheduleDeletion(prefsUser, new Date(Date.now() - 1000));
          expect(await users.purgeAccount(prefsUser)).toBe(true);
          expect(
            (await owner.query('SELECT count(*)::int AS n FROM notification_preferences')).rows[0]!
              .n
          ).toBe(0);

          // Feature guide G6: signing one device out with the restricted
          // runtime role, before and after the owner-run auth-sessions SQL.
          const sessionUser = (
            await owner.query<{ id: string }>(
              `INSERT INTO users (email, password_hash, display_name, timezone, default_currency)
               VALUES ('sessions-role@example.com', 'x', 'Sessions', 'UTC', 'USD') RETURNING id`
            )
          ).rows[0]!.id;
          const newSession = async () =>
            (
              await runtime.query<{ id: string }>(
                `INSERT INTO auth_sessions (user_id, absolute_expires_at, device_platform, created_ip)
                 VALUES ($1, now() + interval '1 day', 'ios', '203.0.113.9') RETURNING id`,
                [sessionUser]
              )
            ).rows[0]!.id;
          const reasonOf = async (id: string) =>
            (
              await owner.query<{ revoked_reason: string | null }>(
                'SELECT revoked_reason FROM auth_sessions WHERE id = $1',
                [id]
              )
            ).rows[0]!.revoked_reason;
          const sessions = new PgSessionsRepository(runtime);
          resetSessionRevokeReasonCache();
          const beforeSql = await newSession();
          expect(await sessions.revoke(sessionUser, beforeSql)).toEqual({
            outcome: 'revoked',
            reason: 'logout'
          });
          expect(await reasonOf(beforeSql)).toBe('logout');
          const sessionsSql = await readFile(
            new URL('../../../docs/auth/sql/auth-sessions-user-revoked.sql', import.meta.url),
            'utf8'
          );
          await owner.query(sessionsSql);
          // A second run replaces the constraint with the same one.
          await owner.query(sessionsSql);
          resetSessionRevokeReasonCache();
          const afterSql = await newSession();
          expect(await sessions.revoke(randomUUID(), afterSql)).toEqual({ outcome: 'not_found' });
          expect(await sessions.revoke(sessionUser, afterSql)).toEqual({
            outcome: 'revoked',
            reason: 'user_revoked'
          });
          expect(await reasonOf(afterSql)).toBe('user_revoked');
          const listed = await sessions.listActive(sessionUser, null, 10);
          expect(listed.map((session) => session.id)).not.toContain(afterSql);
          expect(JSON.stringify(listed)).not.toContain('203.0.113.9');
          await users.scheduleDeletion(sessionUser, new Date(Date.now() - 1000));
          expect(await users.purgeAccount(sessionUser)).toBe(true);

          // AI-P: reporting AI output with the restricted runtime role, before
          // and after the owner-run ai-content-reports SQL. Append-only.
          const reportUser = (
            await owner.query<{ id: string }>(
              `INSERT INTO users (email, password_hash, display_name, timezone, default_currency)
               VALUES ('reports-role@example.com', 'x', 'Reports', 'UTC', 'USD') RETURNING id`
            )
          ).rows[0]!.id;
          const reports = new PgAiReportsRepository(runtime);
          const sample = {
            userId: reportUser,
            surface: 'assistant' as const,
            category: 'harmful' as const,
            replyText: 'reply text',
            note: null,
            locale: 'en'
          };
          expect(await reports.create(sample)).toEqual({ available: false, created: false });
          const reportsSql = await readFile(
            new URL('../../../docs/ai/sql/ai-content-reports.sql', import.meta.url),
            'utf8'
          );
          await owner.query(reportsSql);
          const canReports = async (privilege: string) =>
            (
              await owner.query<{ ok: boolean }>(
                `SELECT has_table_privilege('lifestyle_app', 'public.ai_content_reports', $1) AS ok`,
                [privilege]
              )
            ).rows[0]!.ok;
          for (const [privilege, expected] of [
            ['SELECT', true],
            ['INSERT', true],
            ['DELETE', true],
            ['UPDATE', false],
            ['TRUNCATE', false]
          ] as const) {
            expect(await canReports(privilege)).toBe(expected);
          }
          await expect(owner.query(reportsSql)).rejects.toMatchObject({ code: '42P07' });
          await owner.query('ROLLBACK');
          expect(await reports.create(sample)).toEqual({ available: true, created: true });
          await expect(
            runtime.query(`UPDATE ai_content_reports SET category = 'spam'`)
          ).rejects.toMatchObject({ code: '42501' });
          expect(await reports.purgeOlderThan(new Date(Date.now() + 60_000))).toBe(1);
          expect(await reports.create(sample)).toEqual({ available: true, created: true });
          await users.scheduleDeletion(reportUser, new Date(Date.now() - 1000));
          expect(await users.purgeAccount(reportUser)).toBe(true);
          expect(
            (await owner.query('SELECT count(*)::int AS n FROM ai_content_reports')).rows[0]!.n
          ).toBe(0);

          // AI-2: AI settings and the AI consent with the restricted runtime
          // role, before and after the owner-run ai-user-settings SQL.
          const settingsUser = (
            await owner.query<{ id: string }>(
              `INSERT INTO users (email, password_hash, display_name, timezone, default_currency)
               VALUES ('settings-role@example.com', 'x', 'Settings', 'UTC', 'USD') RETURNING id`
            )
          ).rows[0]!.id;
          const aiSettings = new PgAiSettingsRepository(runtime);
          expect(await aiSettings.find(settingsUser)).toEqual({ available: false });
          expect(await aiSettings.update(settingsUser, { egressConsentVersion: 1 })).toEqual({
            available: false
          });
          const settingsSql = await readFile(
            new URL('../../../docs/ai/sql/ai-user-settings.sql', import.meta.url),
            'utf8'
          );
          await owner.query(settingsSql);
          const canSettings = async (privilege: string) =>
            (
              await owner.query<{ ok: boolean }>(
                `SELECT has_table_privilege('lifestyle_app', 'public.ai_user_settings', $1) AS ok`,
                [privilege]
              )
            ).rows[0]!.ok;
          for (const [privilege, expected] of [
            ['SELECT', true],
            ['INSERT', true],
            ['UPDATE', true],
            ['DELETE', true],
            ['TRUNCATE', false]
          ] as const) {
            expect(await canSettings(privilege)).toBe(expected);
          }
          await expect(owner.query(settingsSql)).rejects.toMatchObject({ code: '42P07' });
          await owner.query('ROLLBACK');
          const granted = await aiSettings.update(settingsUser, { egressConsentVersion: 1 });
          expect(granted).toMatchObject({
            available: true,
            settings: { egressConsentVersion: 1, languageMode: 'auto' }
          });
          expect(
            await aiSettings.update(settingsUser, { languageMode: 'app_locale' })
          ).toMatchObject({
            available: true,
            settings: { egressConsentVersion: 1, languageMode: 'app_locale' }
          });
          await users.scheduleDeletion(settingsUser, new Date(Date.now() - 1000));
          expect(await users.purgeAccount(settingsUser)).toBe(true);
          expect(
            (await owner.query('SELECT count(*)::int AS n FROM ai_user_settings')).rows[0]!.n
          ).toBe(0);
        } finally {
          await runtime.end();
        }
      } finally {
        await owner.query('ROLLBACK').catch(() => undefined);
        await owner.end();
      }
    } finally {
      await admin.end();
    }
  }, 30000);
});
