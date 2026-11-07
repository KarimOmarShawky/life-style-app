import '../infrastructure-safety.js';
/**
 * tests/integration/neon-erasure-draft.test.ts
 *
 * Rehearsal for docs/remediation/drafts/neon-observed-schema-erasure.sql —
 * the erasure adapted to the observed Neon catalog (no wallet tables in
 * that catalog, no lifestyle_app role there). CI runs this against the
 * fully migrated schema (which DOES have wallet tables) to prove the
 * script deletes retired rows wherever they exist, detaches but
 * preserves subscriptions/reminders, and leaves unrelated data intact.
 * Everything happens inside one transaction that is rolled back.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const enabled = process.env.TEST_DRAFT_ERASURE === '1';

describe.skipIf(!enabled)('Neon-adapted erasure draft (rollback rehearsal)', () => {
  it('erases retired rows, detaches subscriptions, preserves unrelated data', async () => {
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
      new URL('../../../docs/remediation/drafts/neon-observed-schema-erasure.sql', import.meta.url),
      'utf8'
    )
      // The rehearsal wraps the draft in its own transaction; the file's
      // BEGIN/COMMIT are for the real single-transaction run.
      .replace(/^\s*BEGIN;\s*$/m, '')
      .replace(/^\s*COMMIT;\s*$/m, '');

    const db = new Client({ connectionString: migratorUrl.toString() });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout = '5s'");

      const user = await db.query<{ id: string }>(
        `INSERT INTO users(email,password_hash,display_name,default_currency)
         VALUES ($1,'fixture','Neon draft fixture','USD') RETURNING id`,
        [`${randomUUID()}@example.test`]
      );
      const userId = user.rows[0]!.id;
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
      await db.query(
        `INSERT INTO reminders(user_id,subscription_id,source,remind_at,channel,next_attempt_at)
         VALUES($1,$2,'user','2099-01-30T09:00:00Z','in_app','2099-01-30T09:00:00Z')`,
        [userId, subId]
      );
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
      await db.query('INSERT INTO ingest_tokens(user_id,session_id,token_hash) VALUES($1,$2,$3)', [
        userId,
        session.rows[0]!.id,
        Buffer.alloc(32, 9)
      ]);
      const wallet = await db.query<{ id: string }>(
        'INSERT INTO wallet_accounts DEFAULT VALUES RETURNING id'
      );
      await db.query(
        `INSERT INTO wallet_owned_records(wallet_account_id,id,kind,envelope) VALUES($1,$2,'review',$3)`,
        [wallet.rows[0]!.id, randomUUID(), Buffer.from('synthetic')]
      );
      await db.query(`INSERT INTO notes(user_id,title,body) VALUES($1,'Keep note','unrelated')`, [
        userId
      ]);
      await db.query(`INSERT INTO tasks(user_id,title) VALUES($1,'Keep task')`, [userId]);
      await db.query(
        `INSERT INTO audit_logs(actor_type,event_type,outcome,entity_type,metadata)
         VALUES ('system','transaction.created','success','transaction','{"amount":"12"}'),
                ('system','subscription.paid','success','subscription','{}'),
                ('system','fixture.keep','success','note','{}')`
      );

      await db.query(script);

      const counts = await db.query<{ table_name: string; n: string }>(
        `SELECT 'transactions' AS table_name, count(*) AS n FROM transactions
         UNION ALL SELECT 'budgets', count(*) FROM budgets
         UNION ALL SELECT 'categories', count(*) FROM categories
         UNION ALL SELECT 'ingest_tokens', count(*) FROM ingest_tokens
         UNION ALL SELECT 'wallet_owned_records', count(*) FROM wallet_owned_records`
      );
      for (const row of counts.rows) expect(Number(row.n), row.table_name).toBe(0);

      const keptSub = await db.query('SELECT name, category_id FROM subscriptions WHERE id = $1', [
        subId
      ]);
      expect(keptSub.rows).toEqual([{ name: 'Keep subscription', category_id: null }]);
      const kept = await db.query(
        `SELECT (SELECT count(*) FROM reminders WHERE subscription_id = $1) AS reminders,
                (SELECT count(*) FROM notes WHERE user_id = $2) AS notes,
                (SELECT count(*) FROM tasks WHERE user_id = $2) AS tasks,
                (SELECT count(*) FROM audit_logs WHERE event_type = 'fixture.keep') AS audit_kept,
                (SELECT count(*) FROM audit_logs WHERE entity_type = 'transaction'
                    OR event_type = 'subscription.paid') AS audit_financial`,
        [subId, userId]
      );
      expect(Number(kept.rows[0].reminders)).toBe(1);
      expect(Number(kept.rows[0].notes)).toBe(1);
      expect(Number(kept.rows[0].tasks)).toBe(1);
      expect(Number(kept.rows[0].audit_kept)).toBe(1);
      expect(Number(kept.rows[0].audit_financial)).toBe(0);
    } finally {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.end();
    }
  });
});
