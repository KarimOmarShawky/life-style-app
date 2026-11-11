-- Feature guide G6: auth_sessions.revoked_reason accepts 'user_revoked'
-- (signing one device out from the signed-in devices list). ADR-047.
--
-- OWNER-RUN ONLY. The production database (owner-managed Neon) has no
-- node-pg-migrate ledger, so `npm run migrate:up` must NOT be run there
-- (see docs/remediation/drafts/ERASURE_STATUS.md, "Migration-ledger hazard").
--
-- 1. Rehearse on a fresh Neon branch of production first and check the
--    verification queries in docs/auth/signed-in-devices.md.
-- 2. Then run this whole file once on production in the Neon SQL editor.
--    It is a single transaction: if any statement fails nothing is applied.
--    Running it a second time replaces the constraint with the same one.
-- 3. It can run before or after the backend deploy. Until it is applied,
--    signing a device out still works: the session is revoked with the
--    reason 'logout' instead of 'user_revoked'.
--
-- No row is changed. The table is locked for the moment the constraint is
-- checked against the existing sessions (a small table).
BEGIN;
-- BEGIN MIGRATION BODY
    DO $drop$
    DECLARE
      old_check record;
    BEGIN
      FOR old_check IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'auth_sessions'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%revoked_reason = ANY%'
      LOOP
        EXECUTE format('ALTER TABLE auth_sessions DROP CONSTRAINT %I', old_check.conname);
      END LOOP;
    END $drop$;
    ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_revoked_reason_check CHECK (revoked_reason IN (
      'logout', 'logout_all', 'password_change', 'password_reset',
      'reuse_detected', 'account_disabled', 'account_deletion', 'user_revoked'
    ));
-- END MIGRATION BODY
COMMIT;
