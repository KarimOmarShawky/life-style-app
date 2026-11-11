-- AI-P: ai_content_reports table (in-app reports of AI output, required by
-- the Google Play AI-Generated Content policy). Hybrid AI audit, AI0-F2.
--
-- OWNER-RUN ONLY. The production database (owner-managed Neon) has no
-- node-pg-migrate ledger, so `npm run migrate:up` must NOT be run there
-- (see docs/remediation/drafts/ERASURE_STATUS.md, "Migration-ledger hazard").
--
-- 1. Rehearse on a fresh Neon branch of production first and check the
--    verification queries in docs/ai/ai-content-reports.md.
-- 2. Then run this whole file once on production in the Neon SQL editor.
--    It is a single transaction: if any statement fails nothing is applied,
--    and running it a second time fails harmlessly on CREATE TABLE.
-- 3. Run it before publishing an app version with the report button. Until
--    it is applied, the deployed API refuses reports with 503
--    AI_REPORTS_UNAVAILABLE, and export and account deletion skip the absent
--    table.
--
-- No existing row is changed.
BEGIN;
-- BEGIN MIGRATION BODY
    CREATE TABLE ai_content_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      surface TEXT NOT NULL CHECK (surface IN ('assistant', 'weekly_coaching', 'analytics_insight')),
      category TEXT NOT NULL CHECK (category IN ('offensive', 'harmful', 'inaccurate', 'spam', 'other')),
      reply_text TEXT CHECK (reply_text IS NULL OR char_length(reply_text) BETWEEN 1 AND 4000),
      note TEXT CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
      locale VARCHAR(16) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_ai_content_reports_created ON ai_content_reports (created_at);
    CREATE INDEX idx_ai_content_reports_user_created ON ai_content_reports (user_id, created_at);
    DO $grant$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
        GRANT SELECT, INSERT, DELETE ON ai_content_reports TO lifestyle_app;
      END IF;
    END $grant$;
-- END MIGRATION BODY
COMMIT;
