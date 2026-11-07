-- =====================================================================
-- DRAFT — NOT YET RUN ANYWHERE. Rehearse on an isolated Neon branch
-- first (same procedure as the erasure), then run once on production
-- by the account owner. See FINANCIAL_ERASURE_RUNBOOK.md.
--
-- Purpose: make the erased, owner-managed Neon database (`neondb`)
-- able to run the current application again, safely:
--   1. Creates the restricted runtime role `lifestyle_app`
--      (NOSUPERUSER, no memberships). Its PASSWORD IS NOT IN THIS FILE:
--      the owner sets it afterwards, only inside their own SQL editor
--      session, and puts the same value into Railway's DATABASE_URL.
--      Never paste passwords or connection strings into chat/tickets.
--   2. Creates the empty wallet tables the production startup guard
--      requires to exist (they were absent in the observed catalog;
--      the retired feature stays retired — runtime gets no write
--      access to them).
--   3. Creates the financial-retirement marker the guard requires
--      (public.financial_retirement_state, feature 'legacy_money_v1')
--      and locks it down (runtime: SELECT only).
--   4. Grants the runtime exactly what current code needs: full CRUD
--      on live app tables that exist, SELECT/INSERT on audit_logs,
--      and on retired tables only SELECT + DELETE (account cleanup)
--      plus UPDATE(revoked_at) on ingest_tokens. No INSERT and no
--      other UPDATE on retired tables — for the runtime AND PUBLIC.
--   5. Fails closed (whole transaction rolls back) if the financial
--      erasure has not actually happened or if, at the end, the
--      startup-guard conditions for `lifestyle_app` do not hold.
--
-- This script does NOT delete any data. Run order: erasure first
-- (neon-observed-schema-erasure.sql), writers stopped, this second.
-- =====================================================================

BEGIN;

-- Preflight: retirement must already be real, not assumed.
DO $$
DECLARE
  remaining bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.transactions)
       + (SELECT count(*) FROM public.budgets)
       + (SELECT count(*) FROM public.categories)
       + (SELECT count(*) FROM public.ingest_tokens)
    INTO remaining;
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'retired financial rows still present: % — run the erasure first', remaining;
  END IF;
END
$$;

-- 1. Restricted runtime role (idempotent; password set separately).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
    CREATE ROLE lifestyle_app WITH LOGIN NOSUPERUSER NOCREATEDB
      NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;
-- Ensure the role can never be a superuser even if pre-created wrongly.
DO $$
DECLARE
  r record;
BEGIN
  SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin
    INTO r FROM pg_roles WHERE rolname = 'lifestyle_app';
  IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR NOT r.rolcanlogin THEN
    BEGIN
      ALTER ROLE lifestyle_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'lifestyle_app has unsafe attributes and this session cannot fix them; run as the database owner';
    END;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO lifestyle_app', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO lifestyle_app;

-- 2. Empty wallet tables (guard requires existence; exact migration DDL).
CREATE TABLE IF NOT EXISTS public.wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.wallet_account_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id UUID NOT NULL REFERENCES public.wallet_accounts(id),
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_wallet_account_sessions_account
  ON public.wallet_account_sessions(wallet_account_id);
CREATE INDEX IF NOT EXISTS idx_wallet_account_sessions_expiry
  ON public.wallet_account_sessions(expires_at);
CREATE OR REPLACE FUNCTION public.wallet_session_revocation_is_final() RETURNS trigger
LANGUAGE plpgsql AS $body$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'wallet session revocation is final';
  END IF;
  RETURN NEW;
END;
$body$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'wallet_session_revocation_final'
       AND tgrelid = 'public.wallet_account_sessions'::regclass
  ) THEN
    CREATE TRIGGER wallet_session_revocation_final
      BEFORE UPDATE OF revoked_at ON public.wallet_account_sessions
      FOR EACH ROW EXECUTE FUNCTION public.wallet_session_revocation_is_final();
  END IF;
END
$$;
CREATE TABLE IF NOT EXISTS public.wallet_owned_records (
  wallet_account_id UUID NOT NULL REFERENCES public.wallet_accounts(id),
  id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('candidate', 'review', 'transaction', 'quarantine')),
  envelope BYTEA NOT NULL CHECK (octet_length(envelope) BETWEEN 1 AND 90000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (wallet_account_id, id)
);

-- 3. Retirement marker (same contract as the startup guard reads).
CREATE TABLE IF NOT EXISTS public.financial_retirement_state (
  feature text PRIMARY KEY,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.financial_retirement_state(feature) VALUES ('legacy_money_v1')
  ON CONFLICT (feature) DO NOTHING;

-- 4a. Retired tables: runtime + PUBLIC lose every write path the guard
-- rejects; runtime keeps SELECT + DELETE for account cleanup only.
REVOKE ALL ON public.categories, public.transactions, public.budgets
  FROM PUBLIC, lifestyle_app;
REVOKE ALL ON public.ingest_tokens FROM PUBLIC, lifestyle_app;
REVOKE ALL ON public.wallet_owned_records, public.wallet_account_sessions,
  public.wallet_accounts FROM PUBLIC, lifestyle_app;
REVOKE ALL ON public.financial_retirement_state FROM PUBLIC, lifestyle_app;
GRANT SELECT, DELETE ON public.categories, public.transactions, public.budgets
  TO lifestyle_app;
GRANT SELECT, DELETE ON public.ingest_tokens TO lifestyle_app;
GRANT UPDATE (revoked_at) ON public.ingest_tokens TO lifestyle_app;
GRANT SELECT ON public.financial_retirement_state TO lifestyle_app;

-- 4b. Live application tables: full CRUD wherever the table exists in
-- this older owner-managed schema (missing tables are skipped, never
-- created implicitly by a GRANT).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'auth_sessions', 'refresh_tokens', 'push_devices',
    'goals', 'milestones', 'projects', 'recurring_tasks', 'habits',
    'recurrences', 'tasks', 'timer_sessions', 'habit_checkins', 'notes',
    'note_links', 'events', 'subscriptions', 'reminders',
    'password_reset_requests'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO lifestyle_app', t);
    END IF;
  END LOOP;
END
$$;
GRANT SELECT, INSERT ON public.audit_logs TO lifestyle_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lifestyle_app;

-- 5. Self-verification mirroring the production startup guard
-- (financial-retirement-guard.ts) with lifestyle_app as the subject:
-- marker present, all 8 target relations exist, and no assumable role
-- of the runtime is superuser / owner-member or holds a retired write.
DO $$
DECLARE
  bad text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.financial_retirement_state WHERE feature = 'legacy_money_v1'
  ) THEN
    RAISE EXCEPTION 'retirement marker missing';
  END IF;

  WITH targets(name, allow_update) AS (
    VALUES ('categories', false), ('transactions', false), ('budgets', false),
      ('ingest_tokens', true), ('wallet_owned_records', false),
      ('wallet_account_sessions', false), ('wallet_accounts', false),
      ('financial_retirement_state', false)
  ), relations AS (
    SELECT t.name, t.allow_update, c.oid, c.relowner
      FROM targets t
      LEFT JOIN pg_namespace n ON n.nspname = 'public'
      LEFT JOIN pg_class c
        ON c.relnamespace = n.oid AND c.relname = t.name AND c.relkind IN ('r', 'p')
  ), assumable AS (
    SELECT r.oid, r.rolname, r.rolsuper FROM pg_roles r
     WHERE pg_has_role('lifestyle_app', r.oid, 'MEMBER')
  )
  SELECT string_agg(DISTINCT t.name, ', ') INTO bad
    FROM relations t CROSS JOIN assumable r
   WHERE t.oid IS NULL
      OR r.rolsuper
      OR pg_has_role(r.oid, t.relowner, 'MEMBER')
      OR has_table_privilege(r.oid, t.oid, 'INSERT')
      OR has_any_column_privilege(r.oid, t.oid, 'INSERT')
      OR (NOT t.allow_update AND (
        has_table_privilege(r.oid, t.oid, 'UPDATE')
        OR has_any_column_privilege(r.oid, t.oid, 'UPDATE')))
      OR (t.name = 'ingest_tokens' AND (
        has_table_privilege(r.oid, t.oid, 'UPDATE') OR EXISTS (
          SELECT 1 FROM pg_attribute a
           WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
             AND a.attname <> 'revoked_at'
             AND has_column_privilege(r.oid, t.oid, a.attnum, 'UPDATE'))))
      OR (t.name = 'financial_retirement_state' AND (
        has_table_privilege(r.oid, t.oid, 'DELETE')
        OR has_table_privilege(r.oid, t.oid, 'TRUNCATE')));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'startup-guard conditions not met for: %', bad;
  END IF;
END
$$;

COMMIT;
