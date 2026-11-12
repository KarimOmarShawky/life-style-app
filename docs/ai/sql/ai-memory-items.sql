-- Hybrid AI slice AI-3: ai_memory_items table (explicit memory: short texts
-- the user asks the assistant to remember).
--
-- OWNER-RUN ONLY. The production database (owner-managed Neon) has no
-- node-pg-migrate ledger, so `npm run migrate:up` must NOT be run there
-- (see docs/remediation/drafts/ERASURE_STATUS.md, "Migration-ledger hazard").
--
-- 0. Apply docs/ai/sql/ai-user-settings.sql (AI-2) first: saving a memory
--    needs the memory switches stored there.
-- 1. Rehearse on a fresh Neon branch of production first and check the
--    verification queries in docs/ai/ai-memory.md.
-- 2. Then run this whole file once on production in the Neon SQL editor.
--    It is a single transaction: if any statement fails nothing is applied,
--    and running it a second time fails harmlessly on CREATE TABLE.
-- 3. It can run before or after the backend deploy. Until it is applied,
--    the deployed API degrades safely: the memory list is empty with
--    available=false, saving, editing and deleting answer 503
--    AI_MEMORY_UNAVAILABLE, the assistant uses no memories, and export and
--    account deletion skip the absent table.
--
-- No existing row is changed.
BEGIN;
-- BEGIN MIGRATION BODY
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
-- END MIGRATION BODY
COMMIT;
