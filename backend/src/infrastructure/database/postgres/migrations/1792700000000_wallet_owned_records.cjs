/**
 * Unwired append-only wallet-owned envelope storage. No legacy data is copied.
 * The server does not verify that a submitted envelope is encrypted or that
 * an SMS belonged to an account; both require a trusted capture design first.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE wallet_owned_records (
      wallet_account_id UUID NOT NULL REFERENCES wallet_accounts(id),
      id UUID NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('candidate', 'review', 'transaction', 'quarantine')),
      envelope BYTEA NOT NULL CHECK (octet_length(envelope) BETWEEN 1 AND 90000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (wallet_account_id, id)
    );
    -- Runtime cannot reassign, rewrite, or delete saved envelopes. A future
    -- lifecycle/erasure mechanism requires a separately reviewed design.
    GRANT SELECT, INSERT ON wallet_owned_records TO lifestyle_app;
  `);
};

exports.down = () => {
  throw new Error('Wallet owned records migration is forward-only');
};
