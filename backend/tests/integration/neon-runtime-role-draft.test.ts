import '../infrastructure-safety.js';
/**
 * tests/integration/neon-runtime-role-draft.test.ts
 *
 * Rehearsal for docs/remediation/drafts/neon-runtime-role-and-marker.sql —
 * the post-erasure deployment step for the observed Neon database:
 * restricted runtime role + retirement marker + locked-down retired
 * tables, so the production startup guard
 * (financial-retirement-guard.ts) can pass with `lifestyle_app` as the
 * runtime. Runs rollback-only inside one transaction on the migrated
 * CI schema; the script's own self-verification must accept, and the
 * negative checks below confirm the runtime really lost retired writes
 * while keeping the access current code needs.
 */

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const enabled = process.env.TEST_DRAFT_ERASURE === '1';

describe.skipIf(!enabled)('Neon runtime role + marker draft (rollback rehearsal)', () => {
  it('prepares a guard-compliant restricted runtime without deleting data', async () => {
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
      throw new Error('Test requires the isolated test DB and distinct test roles');
    }
    const script = readFileSync(
      new URL('../../../docs/remediation/drafts/neon-runtime-role-and-marker.sql', import.meta.url),
      'utf8'
    )
      .replace(/^\s*BEGIN;\s*$/m, '')
      .replace(/^\s*COMMIT;\s*$/m, '');

    const db = new Client({ connectionString: migratorUrl.toString() });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout = '5s'");

      // The migrated CI schema may hold retired rows from this file's own
      // transaction scope only; the draft refuses to proceed otherwise.
      await db.query('DELETE FROM transactions');
      await db.query('DELETE FROM budgets');
      await db.query('UPDATE subscriptions SET category_id = NULL WHERE category_id IS NOT NULL');
      await db.query('DELETE FROM categories');
      await db.query('DELETE FROM ingest_tokens');

      await db.query(script);

      const marker = await db.query(
        `SELECT count(*)::int AS n FROM financial_retirement_state WHERE feature = 'legacy_money_v1'`
      );
      expect(marker.rows[0].n).toBe(1);

      const priv = async (sqlText: string) =>
        (await db.query<{ ok: boolean }>(sqlText)).rows[0]!.ok;
      // Retired writes are gone for the runtime (PUBLIC included via
      // has_table_privilege semantics), cleanup/revocation remain.
      expect(
        await priv(
          `SELECT has_table_privilege('lifestyle_app', 'public.transactions', 'INSERT') AS ok`
        )
      ).toBe(false);
      expect(
        await priv(
          `SELECT has_table_privilege('lifestyle_app', 'public.categories', 'UPDATE') AS ok`
        )
      ).toBe(false);
      expect(
        await priv(
          `SELECT has_table_privilege('lifestyle_app', 'public.ingest_tokens', 'UPDATE') AS ok`
        )
      ).toBe(false);
      expect(
        await priv(
          `SELECT has_column_privilege('lifestyle_app', 'public.ingest_tokens', 'revoked_at', 'UPDATE') AS ok`
        )
      ).toBe(true);
      expect(
        await priv(
          `SELECT has_column_privilege('lifestyle_app', 'public.ingest_tokens', 'token_hash', 'UPDATE') AS ok`
        )
      ).toBe(false);
      expect(
        await priv(
          `SELECT has_table_privilege('lifestyle_app', 'public.financial_retirement_state', 'DELETE') AS ok`
        )
      ).toBe(false);
      expect(
        await priv(
          `SELECT has_table_privilege('lifestyle_app', 'public.financial_retirement_state', 'SELECT') AS ok`
        )
      ).toBe(true);
      // Live features keep working for the runtime.
      expect(
        await priv(`SELECT has_table_privilege('lifestyle_app', 'public.tasks', 'INSERT') AS ok`)
      ).toBe(true);
      expect(
        await priv(
          `SELECT has_table_privilege('lifestyle_app', 'public.subscriptions', 'UPDATE') AS ok`
        )
      ).toBe(true);
      expect(
        await priv(
          `SELECT has_table_privilege('lifestyle_app', 'public.audit_logs', 'INSERT') AS ok`
        )
      ).toBe(true);
      expect(
        await priv(
          `SELECT has_table_privilege('lifestyle_app', 'public.transactions', 'DELETE') AS ok`
        )
      ).toBe(true);
    } finally {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.end();
    }
  });
});
