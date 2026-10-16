-- Upgrade for background SMS capture (ingest tokens) and focus sessions without a task.
--
-- Same change as the migrations 1727300003000_ingest_tokens and 1727300004000_timer_sessions_optional_task.
-- Use this file when `npm run migrate:up` cannot be used, for example on a database that was created by the
-- schema bootstrap (it has no pgmigrations history). Run it as the migration role (lifestyle_migrator).
--
-- Idempotent: running it again changes nothing.
--
-- Use either this file or `npm run migrate:up`, not both. After this file has run, migrate:up
-- fails on the CREATE TABLE of 1727300003000 because the table already exists.

CREATE TABLE IF NOT EXISTS ingest_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_tokens_active_session
  ON ingest_tokens (session_id)
  WHERE revoked_at IS NULL;

DO $body$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ingest_tokens TO lifestyle_app;
  END IF;
END $body$;

ALTER TABLE timer_sessions ALTER COLUMN task_id DROP NOT NULL;
