-- =====================================================================
-- DRAFT — NOT YET RUN ANYWHERE. DO NOT RUN UNTIL THE CHECKLIST BELOW
-- HAS BEEN COMPLETED AND THIS FILE HAS BEEN REHEARSED ON A CLONE.
--
-- Adapted erasure for the OBSERVED Neon schema (2026-11-06 user catalog):
--   present : subscriptions, transactions, budgets, categories,
--             ingest_tokens, audit_logs, reminders (+ app tables)
--   absent  : wallet_owned_records, wallet_account_sessions,
--             wallet_accounts, pgmigrations, financial retirement marker
--   roles   : no lifestyle_app role; tables owned by the editor identity
--
-- Why a separate draft: the adjacent node-pg-migrate draft
-- (1792800000000_erase_retired_money.cjs) LOCKS the absent wallet tables
-- and requires the lifestyle_app runtime role, so it FAILS on this
-- database. This file deletes the same retired rows without assuming
-- either. It does NOT solve the owner-identity problem: while the app
-- connects as the table owner, grants cannot stop it recreating data;
-- the retired routes already return HTTP 410 in current code, and a
-- restricted runtime role cutover remains a separate production step.
--
-- Scope (identical policy to the main draft):
--   DELETE  all rows of transactions, budgets, categories, ingest_tokens
--   DELETE  wallet tables' rows ONLY if those tables exist (dynamic)
--   DELETE  financial audit events (transaction/budget/category classes
--           and subscription.paid) from audit_logs
--   DETACH  subscriptions.category_id (subscriptions are PRESERVED,
--           together with reminders, accounts, tasks, habits, notes
--           and every other non-financial table)
--   NEVER   touches original phone SMS (outside the database entirely)
--
-- Preconditions (all mandatory, see FINANCIAL_ERASURE_RUNBOOK.md):
--   1. Old API/worker instances drained; nothing can write these tables.
--   2. A protected backup exists and its restore was tested on an
--      ISOLATED clone — restoring it later resurrects financial data.
--   3. This exact file rehearsed (run + rollback test) on a clone with
--      the same table set; row-count evidence reviewed by a human.
--   4. Run inside one transaction (this file opens it). ANY error or
--      failed verification aborts everything: no partial deletion.
-- =====================================================================

BEGIN;

-- Preflight: fail closed on any incoming FK to retired tables beyond the
-- catalog observed in 2026-11 (subscriptions/transactions/budgets ->
-- categories). An unknown dependency means STOP and review, not delete.
DO $$
DECLARE
  unexpected text;
BEGIN
  SELECT string_agg(DISTINCT conrelid::regclass::text, ', ')
    INTO unexpected
    FROM pg_constraint
   WHERE contype = 'f'
     AND confrelid IN (
       'public.transactions'::regclass, 'public.budgets'::regclass,
       'public.categories'::regclass, 'public.ingest_tokens'::regclass)
     AND conrelid NOT IN (
       'public.subscriptions'::regclass, 'public.transactions'::regclass,
       'public.budgets'::regclass);
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected foreign keys into retired tables from: %', unexpected;
  END IF;
END
$$;

LOCK TABLE public.subscriptions, public.transactions, public.budgets,
  public.categories, public.ingest_tokens, public.audit_logs
  IN ACCESS EXCLUSIVE MODE;

-- Detach (do not delete) subscriptions from their financial categories.
UPDATE public.subscriptions
   SET category_id = NULL, version = version + 1
 WHERE category_id IS NOT NULL;

DELETE FROM public.transactions;
DELETE FROM public.budgets;
DELETE FROM public.categories;
DELETE FROM public.ingest_tokens;

-- Wallet tables are absent in the observed schema; delete only if a
-- different target actually has them.
DO $$
BEGIN
  IF to_regclass('public.wallet_owned_records') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.wallet_owned_records';
  END IF;
  IF to_regclass('public.wallet_account_sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.wallet_account_sessions';
  END IF;
  IF to_regclass('public.wallet_accounts') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.wallet_accounts';
  END IF;
END
$$;

DELETE FROM public.audit_logs
 WHERE entity_type IN ('transaction', 'budget', 'category')
    OR event_type LIKE 'transaction.%'
    OR event_type = 'subscription.paid';

-- Verify inside the transaction: retired tables must be empty and the
-- preserved subscription rows must still exist exactly as before
-- (count check is the caller's to compare with the pre-run snapshot).
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
    RAISE EXCEPTION 'retired rows remain: %', remaining;
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE category_id IS NOT NULL) THEN
    RAISE EXCEPTION 'subscriptions still reference deleted categories';
  END IF;
END
$$;

COMMIT;
