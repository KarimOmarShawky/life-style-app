/**
 * Separate, unwired wallet identity/session groundwork. No phone number, SMS,
 * mapping to app users or existing financial records is stored here. A future
 * login must not issue a session until identity/recovery and OTP consumption
 * are safely coupled to durable issuance.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE wallet_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );

    CREATE TABLE wallet_account_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_account_id UUID NOT NULL REFERENCES wallet_accounts(id),
      token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      CHECK (expires_at > created_at)
    );
    CREATE INDEX idx_wallet_account_sessions_account ON wallet_account_sessions(wallet_account_id);
    CREATE INDEX idx_wallet_account_sessions_expiry ON wallet_account_sessions(expires_at);

    -- Revocation is irreversible even if a runtime caller issues raw SQL.
    CREATE FUNCTION wallet_session_revocation_is_final() RETURNS trigger
    LANGUAGE plpgsql AS $body$
    BEGIN
      IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
        RAISE EXCEPTION 'wallet session revocation is final';
      END IF;
      RETURN NEW;
    END;
    $body$;
    CREATE TRIGGER wallet_session_revocation_final
      BEFORE UPDATE OF revoked_at ON wallet_account_sessions
      FOR EACH ROW EXECUTE FUNCTION wallet_session_revocation_is_final();

    -- The runtime may revoke, but cannot reassign an existing session, change
    -- its digest/expiry, erase a principal, or silently resurrect a session.
    GRANT SELECT, INSERT ON wallet_accounts, wallet_account_sessions TO lifestyle_app;
    GRANT UPDATE (revoked_at) ON wallet_account_sessions TO lifestyle_app;
  `);
};

// Account lifecycle and erasure will require an explicitly reviewed migration.
exports.down = () => {
  throw new Error('Wallet account sessions migration is forward-only');
};
