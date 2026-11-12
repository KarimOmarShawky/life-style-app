/**
 * Hybrid AI slice AI-3 (owner decision D4, 2026-11-12).
 *
 * ai_memory_items: short texts (at most 500 characters) the user asks the
 * assistant to remember, each with a kind ('preference' or 'fact'). In AI-3
 * only the user writes them (source 'explicit', status 'active'); the model
 * never does. The columns for learned items (source 'learned', status
 * 'pending' or 'dismissed', confidence, expires_at) are created now for AI-5,
 * so that slice needs no further owner SQL; nothing creates such rows yet.
 *
 * The rows are owned by the account: erased by account deletion
 * (USER_OWNED_TABLES_IN_DELETE_ORDER, and ON DELETE CASCADE), included in the
 * JSON metadata export and deliberately excluded from the versioned v1
 * archive file.
 *
 * Forward-only. Production (owner-managed Neon, no pgmigrations ledger) gets
 * the same statements from docs/ai/sql/ai-memory-items.sql; a unit test
 * keeps both copies identical.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE ai_memory_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('preference', 'fact')),
      content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
      source TEXT NOT NULL CHECK (source IN ('explicit', 'learned')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'dismissed')),
      confidence NUMERIC(3,2) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ,
      CONSTRAINT ai_memory_items_pending_is_learned CHECK (source = 'learned' OR status <> 'pending')
    );
    CREATE INDEX ai_memory_items_user_status_idx ON ai_memory_items (user_id, status);
    DO $grant$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ai_memory_items TO lifestyle_app;
      END IF;
    END $grant$;
  `);
};

exports.down = () => {
  throw new Error('AI memory items migration is forward-only');
};
