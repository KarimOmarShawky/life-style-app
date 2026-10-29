/**
 * Migration: 1792400000000_password_reset_ownership_and_fencing.cjs
 *
 * Two lifecycle corrections on the durable reset queue (V-04, V-06):
 *
 *  1. `lease_token` — a per-claim fencing token. Completion updates are now
 *     predicated on it, so a processor whose lease expired cannot overwrite the
 *     state written by the claimant that recovered the row.
 *  2. `user_id` — an explicit ownership/erasure key. Account deletion removes a
 *     user's reset metadata, and it can be joined for records-of-processing.
 *     It stays nullable because a request for an unknown email must not create
 *     (or reveal) an account.
 */

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE password_reset_requests
      ADD COLUMN IF NOT EXISTS lease_token UUID,
      ADD COLUMN IF NOT EXISTS user_id UUID;

    -- Ownership is real: deleting the account erases its reset metadata.
    DO $body$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_requests_user_fk'
      ) THEN
        ALTER TABLE password_reset_requests
          ADD CONSTRAINT password_reset_requests_user_fk
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END $body$;

    -- Erasure and export look the metadata up by owner.
    CREATE INDEX IF NOT EXISTS idx_password_reset_user
      ON password_reset_requests (user_id)
      WHERE user_id IS NOT NULL;

    -- Retention of abandoned non-terminal rows scans by age.
    CREATE INDEX IF NOT EXISTS idx_password_reset_abandoned
      ON password_reset_requests (updated_at)
      WHERE status IN ('pending', 'failed');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_password_reset_abandoned;
    DROP INDEX IF EXISTS idx_password_reset_user;
    ALTER TABLE password_reset_requests DROP CONSTRAINT IF EXISTS password_reset_requests_user_fk;
    ALTER TABLE password_reset_requests
      DROP COLUMN IF EXISTS user_id,
      DROP COLUMN IF EXISTS lease_token;
  `);
};
