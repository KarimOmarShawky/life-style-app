/**
 * Feature guide G6 (ADR-047, owner approval 2026-11-11).
 *
 * auth_sessions.revoked_reason gains 'user_revoked': the account owner signed
 * one device out from the signed-in devices list. The CHECK constraint on the
 * reason list is replaced by a wider one; every existing row already
 * satisfies it. The old constraint is found by its definition, so its
 * generated name does not matter, and running the body twice changes nothing.
 * The pair check (revoked_at IS NULL) = (revoked_reason IS NULL) is untouched.
 *
 * Forward-only. Production (owner-managed Neon, no pgmigrations ledger) gets
 * the same statements from docs/auth/sql/auth-sessions-user-revoked.sql; a
 * unit test keeps both copies identical.
 */
exports.up = (pgm) => {
  pgm.sql(`
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
  `);
};

exports.down = () => {
  throw new Error('auth_sessions user_revoked migration is forward-only');
};
