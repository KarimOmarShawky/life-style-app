/**
 * Hybrid AI slice AI-2 (owner decisions D3-D5, 2026-11-12).
 *
 * ai_user_settings: at most one row per account with the AI settings and the
 * durable, versioned consent to send AI requests to the provider. No row
 * means the defaults: no consent recorded, memory, learning and quick actions
 * off, replies in the language of the message. No prompt, reply or memory
 * text is stored here.
 *
 * The row is owned by the account: it is erased by account deletion
 * (USER_OWNED_TABLES_IN_DELETE_ORDER, and ON DELETE CASCADE), included in the
 * JSON metadata export and deliberately excluded from the versioned v1
 * archive file.
 *
 * Forward-only. Production (owner-managed Neon, no pgmigrations ledger) gets
 * the same statements from docs/ai/sql/ai-user-settings.sql; a unit test
 * keeps both copies identical.
 */

exports.up = (pgm) => {
  pgm.sql(`
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
  `);
};

exports.down = () => {
  throw new Error('AI user settings migration is forward-only');
};
