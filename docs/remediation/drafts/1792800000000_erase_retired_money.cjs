/**
 * Irreversible product retirement: erase financial transaction, category,
 * budget, wallet and SMS-ingest data for ALL accounts. Subscriptions, their
 * reminders, unrelated audit records and app accounts are retained.
 *
 * Deploy only after draining old app/API instances and stopping jobs that can
 * write these tables. ACCESS EXCLUSIVE locks order already-running writes;
 * revoking runtime write privileges prevents the retired feature from
 * recreating data after this transaction commits. Backups, exported archives,
 * external logs and old app installations require their own lifecycle plan.
 */
exports.up = (pgm) => {
  pgm.sql(`
    LOCK TABLE subscriptions, transactions, budgets, categories, ingest_tokens,
      wallet_owned_records, wallet_account_sessions, wallet_accounts, audit_logs
      IN ACCESS EXCLUSIVE MODE;

    -- A subscription's category is optional; remove that reference without
    -- deleting the subscription, its reminders, or its billing schedule.
    UPDATE subscriptions
      SET category_id = NULL, version = version + 1
      WHERE category_id IS NOT NULL;

    DELETE FROM transactions;
    DELETE FROM budgets;
    DELETE FROM categories;
    DELETE FROM ingest_tokens;
    DELETE FROM wallet_owned_records;
    DELETE FROM wallet_account_sessions;
    DELETE FROM wallet_accounts;

    -- Financial mutations can include exact amounts/currencies in metadata.
    -- Preserve all unrelated audit events and subscription records.
    DELETE FROM audit_logs
      WHERE entity_type IN ('transaction', 'budget', 'category')
         OR event_type LIKE 'transaction.%'
         OR event_type = 'subscription.paid';

    -- Keep DELETE for normal account cleanup and SELECT for old archive
    -- compatibility; neither a running legacy API nor the app runtime can
    -- create new retired records with its normal role after this commit.
    REVOKE INSERT, UPDATE ON categories, transactions, budgets FROM lifestyle_app;
    REVOKE INSERT, UPDATE ON ingest_tokens FROM lifestyle_app;
    GRANT UPDATE (revoked_at) ON ingest_tokens TO lifestyle_app;
    REVOKE ALL ON wallet_owned_records, wallet_account_sessions, wallet_accounts FROM lifestyle_app;

    -- REVOKE from one role does not remove privileges inherited through other
    -- roles or PUBLIC. Abort the entire transaction (including deletion) when
    -- the runtime can still recreate retired data or assume a privileged role.
    DO $preflight$
    DECLARE
      retired_table text;
      privileged_role record;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lifestyle_app' AND NOT rolsuper) THEN
        RAISE EXCEPTION 'lifestyle_app must exist and must not be a superuser';
      END IF;
      FOR privileged_role IN
        SELECT DISTINCT r.rolname FROM pg_roles r
        WHERE r.rolsuper OR r.oid IN (
          SELECT c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname IN (
            'categories', 'transactions', 'budgets', 'ingest_tokens', 'wallet_owned_records',
            'wallet_account_sessions', 'wallet_accounts'
          )
        )
      LOOP
        IF pg_has_role('lifestyle_app', privileged_role.rolname, 'MEMBER') THEN
          RAISE EXCEPTION 'runtime may assume privileged role %', privileged_role.rolname;
        END IF;
      END LOOP;
      -- Also inspect every role the runtime could assume, including roles
      -- whose privileges are not automatically inherited (SET ROLE paths).
      FOR privileged_role IN
        SELECT r.rolname FROM pg_roles r WHERE pg_has_role('lifestyle_app', r.oid, 'MEMBER')
      LOOP
        FOREACH retired_table IN ARRAY ARRAY[
          'categories', 'transactions', 'budgets', 'ingest_tokens', 'wallet_owned_records',
          'wallet_account_sessions', 'wallet_accounts'
        ] LOOP
          IF has_table_privilege(privileged_role.rolname, 'public.' || retired_table, 'INSERT') OR
             has_any_column_privilege(privileged_role.rolname, 'public.' || retired_table, 'INSERT') THEN
            RAISE EXCEPTION 'runtime retains insert access to % through %', retired_table, privileged_role.rolname;
          END IF;
          IF retired_table <> 'ingest_tokens' AND (
            has_table_privilege(privileged_role.rolname, 'public.' || retired_table, 'UPDATE') OR
            has_any_column_privilege(privileged_role.rolname, 'public.' || retired_table, 'UPDATE')
          ) THEN
            RAISE EXCEPTION 'runtime retains update access to % through %', retired_table, privileged_role.rolname;
          END IF;
          IF retired_table = 'ingest_tokens' AND (
            has_table_privilege(privileged_role.rolname, 'public.ingest_tokens', 'UPDATE') OR EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = 'public.ingest_tokens'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                AND a.attname <> 'revoked_at'
                AND has_column_privilege(privileged_role.rolname, a.attrelid, a.attnum, 'UPDATE')
            )
          ) THEN
            RAISE EXCEPTION 'runtime retains update access to % through %', retired_table, privileged_role.rolname;
          END IF;
        END LOOP;
      END LOOP;
    END
    $preflight$;

    -- The marker is written in the same transaction as erasure and grant
    -- revocation. Production API/worker startup must reject a restored backup
    -- that predates this transaction. It cannot detect partial restores made
    -- after startup; the recovery runbook requires those to remain offline.
    CREATE TABLE IF NOT EXISTS public.financial_retirement_state (
      feature text PRIMARY KEY,
      completed_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    REVOKE ALL ON public.financial_retirement_state FROM PUBLIC, lifestyle_app;
    GRANT SELECT ON public.financial_retirement_state TO lifestyle_app;
    INSERT INTO public.financial_retirement_state(feature) VALUES ('legacy_money_v1')
      ON CONFLICT (feature) DO NOTHING;
    DO $marker_guard$
    DECLARE
      assumable_role record;
    BEGIN
      FOR assumable_role IN
        SELECT r.rolname FROM pg_roles r WHERE pg_has_role('lifestyle_app', r.oid, 'MEMBER')
      LOOP
        IF pg_has_role(assumable_role.rolname,
              (SELECT relowner FROM pg_class WHERE oid = 'public.financial_retirement_state'::regclass), 'MEMBER') OR
           has_table_privilege(assumable_role.rolname, 'public.financial_retirement_state', 'INSERT,UPDATE,DELETE,TRUNCATE') OR
           has_any_column_privilege(assumable_role.rolname, 'public.financial_retirement_state', 'INSERT,UPDATE') THEN
          RAISE EXCEPTION 'runtime can modify retirement marker through %', assumable_role.rolname;
        END IF;
      END LOOP;
    END
    $marker_guard$;
  `);
};

exports.down = () => {
  throw new Error("Retired financial data erasure is irreversible");
};
