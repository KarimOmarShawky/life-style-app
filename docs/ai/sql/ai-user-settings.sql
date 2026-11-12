-- Hybrid AI slice AI-2: ai_user_settings table (AI settings and the durable,
-- versioned consent to send AI requests to the provider).
--
-- OWNER-RUN ONLY. The production database (owner-managed Neon) has no
-- node-pg-migrate ledger, so `npm run migrate:up` must NOT be run there
-- (see docs/remediation/drafts/ERASURE_STATUS.md, "Migration-ledger hazard").
--
-- 1. Rehearse on a fresh Neon branch of production first and check the
--    verification queries in docs/ai/ai-settings.md.
-- 2. Then run this whole file once on production in the Neon SQL editor.
--    It is a single transaction: if any statement fails nothing is applied,
--    and running it a second time fails harmlessly on CREATE TABLE.
-- 3. It can run before or after the backend deploy. Until it is applied,
--    the deployed API degrades safely: reading AI settings returns the
--    defaults with available=false, saving answers 503
--    AI_SETTINGS_UNAVAILABLE, and export and account deletion skip the
--    absent table.
--
-- No existing row is changed: accounts without a row keep the defaults
-- (no consent recorded; memory, learning and quick actions off).
BEGIN;
-- BEGIN MIGRATION BODY
    CREATE TABLE ai_user_settings (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      egress_consent_version INTEGER CHECK (egress_consent_version IS NULL OR egress_consent_version > 0),
      egress_consent_at TIMESTAMPTZ,
      memory_enabled BOOLEAN NOT NULL DEFAULT false,
      explicit_memory_enabled BOOLEAN NOT NULL DEFAULT false,
      learning_enabled BOOLEAN NOT NULL DEFAULT false,
      quick_actions_enabled BOOLEAN NOT NULL DEFAULT false,
      language_mode TEXT NOT NULL DEFAULT 'auto' CHECK (language_mode IN ('auto', 'app_locale')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT ai_user_settings_consent_pair CHECK ((egress_consent_version IS NULL) = (egress_consent_at IS NULL))
    );
    DO $grant$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ai_user_settings TO lifestyle_app;
      END IF;
    END $grant$;
-- END MIGRATION BODY
COMMIT;
