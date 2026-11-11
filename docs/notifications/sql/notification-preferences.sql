-- Feature guide G2: notification_preferences table (quiet hours, daily limit,
-- summary, master switch, alarms during quiet hours). ADR-046.
--
-- OWNER-RUN ONLY. The production database (owner-managed Neon) has no
-- node-pg-migrate ledger, so `npm run migrate:up` must NOT be run there
-- (see docs/remediation/drafts/ERASURE_STATUS.md, "Migration-ledger hazard").
--
-- 1. Rehearse on a fresh Neon branch of production first and check the
--    verification queries in docs/notifications/notification-preferences.md.
-- 2. Then run this whole file once on production in the Neon SQL editor.
--    It is a single transaction: if any statement fails nothing is applied,
--    and running it a second time fails harmlessly on CREATE TABLE.
-- 3. It can run before or after the backend deploy. Until it is applied,
--    the deployed API degrades safely: reading settings returns the defaults
--    with available=false, saving answers 503
--    NOTIFICATION_PREFERENCES_UNAVAILABLE, and export and account deletion
--    skip the absent table.
--
-- No existing row is changed: accounts without a row keep the defaults
-- (everything on, no quiet hours, no daily limit).
BEGIN;
-- BEGIN MIGRATION BODY
    CREATE TABLE notification_preferences (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      notifications_enabled BOOLEAN NOT NULL DEFAULT true,
      quiet_start_minute SMALLINT CHECK (quiet_start_minute IS NULL OR quiet_start_minute BETWEEN 0 AND 1439),
      quiet_end_minute SMALLINT CHECK (quiet_end_minute IS NULL OR quiet_end_minute BETWEEN 0 AND 1439),
      daily_cap SMALLINT CHECK (daily_cap IS NULL OR daily_cap BETWEEN 1 AND 50),
      digest_enabled BOOLEAN NOT NULL DEFAULT false,
      critical_breaks_quiet BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT notification_preferences_quiet_pair CHECK ((quiet_start_minute IS NULL) = (quiet_end_minute IS NULL)),
      CONSTRAINT notification_preferences_quiet_distinct CHECK (quiet_start_minute IS NULL OR quiet_start_minute <> quiet_end_minute)
    );
    DO $grant$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO lifestyle_app;
      END IF;
    END $grant$;
-- END MIGRATION BODY
COMMIT;
