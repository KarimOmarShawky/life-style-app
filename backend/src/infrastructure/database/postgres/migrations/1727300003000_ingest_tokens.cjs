/**
 * Migration: 1727300003000_ingest_tokens.cjs
 *
 * Session-bound ingest tokens for the Android SMS receiver. The receiver uses one to save a
 * wallet transaction while the app is closed, without relying on the 15-minute access token.
 * Only a SHA-256 digest of each token is stored. A token stops working when its session ends.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE ingest_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
      token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX idx_ingest_tokens_active_session
      ON ingest_tokens (session_id)
      WHERE revoked_at IS NULL;

    DO $body$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ingest_tokens TO lifestyle_app;
      END IF;
    END $body$;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS ingest_tokens;');
};
