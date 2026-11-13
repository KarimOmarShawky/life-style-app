/**
 * AI-P (Hybrid AI audit 2026-11-11, AI0-F2): in-app reports of AI output, as
 * required by the Google Play AI-Generated Content policy.
 *
 * ai_content_reports: one row per report. It holds the screen that showed the
 * reply, a category, and - only when the user ticked "include the reply" - the
 * reply text and an optional note. No prompt, conversation history or account
 * data is stored. Rows expire after 90 days (worker job purge-ai-reports).
 *
 * The rows are owned by the account: they are erased by account deletion
 * (USER_OWNED_TABLES_IN_DELETE_ORDER, and ON DELETE CASCADE), included in the
 * JSON metadata export and deliberately excluded from the versioned v1
 * archive file. The runtime role is append-only: SELECT, INSERT, DELETE.
 *
 * Forward-only. Production (owner-managed Neon, no pgmigrations ledger) gets
 * the same statements from docs/ai/sql/ai-content-reports.sql; a unit test
 * keeps both copies identical.
 */

exports.up = (pgm) => {
  pgm.sql(`
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
  `);
};

exports.down = () => {
  throw new Error('AI content reports migration is forward-only');
};
