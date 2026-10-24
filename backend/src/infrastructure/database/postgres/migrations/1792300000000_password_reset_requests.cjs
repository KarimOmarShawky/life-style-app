/**
 * Migration: 1792300000000_password_reset_requests.cjs
 *
 * Durable queue for accepted password-reset delivery (F-06).
 *
 * Before this table, an accepted `POST /auth/forgot-password` request lived
 * only in the API process's in-memory dispatcher: a crash, restart, forced
 * shutdown, queue-age expiry or processing failure could drop it after the API
 * had already answered 202. Admission now writes a row first, so accepted work
 * survives process loss and can be retried with a bounded backoff and a
 * dead-letter state.
 *
 * Privacy: no reset code or password is ever stored here. Codes are generated
 * only after a row is claimed, and only a coarse error code is retained.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE password_reset_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email CITEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead_letter')),
      attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error_code VARCHAR(50),
      request_id VARCHAR(128),
      ip VARCHAR(64),
      user_agent VARCHAR(512),
      processing_started_at TIMESTAMPTZ,
      lease_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      CHECK (status <> 'processing' OR lease_expires_at IS NOT NULL),
      CHECK (status NOT IN ('sent', 'dead_letter') OR completed_at IS NOT NULL)
    );

    CREATE INDEX idx_password_reset_due
      ON password_reset_requests (next_attempt_at)
      WHERE status IN ('pending', 'failed');

    CREATE INDEX idx_password_reset_lease
      ON password_reset_requests (lease_expires_at)
      WHERE status = 'processing';

    CREATE INDEX idx_password_reset_retention
      ON password_reset_requests (COALESCE(completed_at, updated_at))
      WHERE status IN ('sent', 'dead_letter');

    DO $body$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_requests TO lifestyle_app;
      END IF;
    END $body$;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS password_reset_requests;');
};
