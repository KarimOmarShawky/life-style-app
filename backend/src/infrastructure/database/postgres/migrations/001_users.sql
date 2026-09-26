-- Users, roles, and the account-protection state machine.
--
-- Spec sections 6, 12, 16, 23. Integrity is enforced HERE, not only in the
-- application, because the database is the last line that cannot be bypassed by
-- a bug in a service or a second client written later.

-- gen_random_uuid() is built into PostgreSQL 13+; no extension required.

-- Email is stored already lower-cased and the constraint enforces it. This gives
-- case-insensitive uniqueness without depending on the citext extension, which
-- needs privileges a least-privilege application role should not have.
CREATE TABLE users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 TEXT        NOT NULL,
    password_hash         TEXT        NOT NULL,
    display_name          TEXT,
    role                  TEXT        NOT NULL DEFAULT 'user',
    is_active             BOOLEAN     NOT NULL DEFAULT TRUE,

    -- Brute-force protection state (spec section 23).
    failed_login_attempts INTEGER     NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,

    -- Bumped on password change so tokens issued earlier stop verifying.
    password_changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT users_email_is_lowercase CHECK (email = lower(email)),
    CONSTRAINT users_email_format       CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    CONSTRAINT users_email_length       CHECK (char_length(email) BETWEEN 3 AND 254),
    CONSTRAINT users_role_valid         CHECK (role IN ('user', 'admin')),
    CONSTRAINT users_failed_attempts_sane CHECK (failed_login_attempts >= 0),
    -- A bcrypt hash is always 60 characters. Anything shorter means a plaintext
    -- password reached the column, which this constraint makes impossible.
    CONSTRAINT users_password_hash_is_hashed CHECK (char_length(password_hash) >= 55)
);

-- Uniqueness is a database constraint, not an application check. Two concurrent
-- registrations both pass a "does this email exist" query; only one can win an
-- insert against a unique index (spec section 32).
CREATE UNIQUE INDEX users_email_key ON users (email);

-- Partial index: administrative listings filter to active accounts, and a
-- partial index is smaller and cheaper to maintain than one over every row.
CREATE INDEX users_active_created_idx ON users (created_at DESC) WHERE is_active;

-- Shared updated_at trigger, reused by every table that carries the column.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
