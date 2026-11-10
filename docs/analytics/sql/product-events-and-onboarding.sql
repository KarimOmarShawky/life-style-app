-- Feature guide G5 + G1: product_events table, opt-out flag and onboarding flag.
--
-- OWNER-RUN ONLY. The production database (owner-managed Neon) has no
-- node-pg-migrate ledger, so `npm run migrate:up` must NOT be run there
-- (see docs/remediation/drafts/ERASURE_STATUS.md, "Migration-ledger hazard").
--
-- 1. Rehearse on a fresh Neon branch of production first and check the
--    verification queries at the end of docs/analytics/product-events.md.
-- 2. Then run this whole file once on production in the Neon SQL editor.
--    It is a single transaction: if any statement fails nothing is applied,
--    and running it a second time fails harmlessly on CREATE TABLE.
-- 3. Until this is applied, the deployed API degrades safely: no onboarding
--    prompt, no events recorded, and deletion/export behave exactly as before.
--
-- The statements between the markers are kept byte-identical to the
-- forward-only migration 1792750000000_product_events_and_onboarding.cjs by
-- backend/tests/unit/product-events-migration.test.ts.

BEGIN;
-- BEGIN MIGRATION BODY
    CREATE TABLE product_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_name TEXT NOT NULL CHECK (event_name IN ('app_opened', 'onboarding_started', 'onboarding_completed', 'onboarding_skipped', 'task_completed', 'habit_checked_in')),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      occurred_on DATE NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'unknown')),
      app_version TEXT CHECK (app_version IS NULL OR app_version ~ '^[0-9A-Za-z.+-]{1,32}$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT product_events_one_per_local_day UNIQUE (user_id, event_name, occurred_on)
    );
    CREATE INDEX idx_product_events_user_occurred ON product_events (user_id, occurred_at);
    CREATE INDEX idx_product_events_name_occurred ON product_events (event_name, occurred_at);
    DO $grant$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
        GRANT SELECT, INSERT, DELETE ON product_events TO lifestyle_app;
      END IF;
    END $grant$;

    ALTER TABLE users ADD COLUMN product_events_enabled BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
    UPDATE users SET onboarding_completed_at = created_at WHERE onboarding_completed_at IS NULL;
-- END MIGRATION BODY
COMMIT;
