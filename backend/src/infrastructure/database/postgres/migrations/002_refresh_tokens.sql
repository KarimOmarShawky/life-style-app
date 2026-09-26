-- Refresh-token storage supporting rotation, revocation and reuse detection.
--
-- Spec sections 10 and 23. Access tokens stay stateless and are never stored.
-- Refresh tokens are stored so that a session can be ended immediately, which a
-- stateless token cannot offer.
--
-- Only the SHA-256 of the token is stored, never the token. A leaked database
-- dump then yields no usable credential. SHA-256 rather than bcrypt is correct
-- here: the token is 128 bits of server-generated randomness, so it is not
-- guessable by dictionary attack, and refresh runs on a hot path where bcrypt's
-- deliberate slowness would be a self-inflicted bottleneck.

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY,               -- equals the JWT 'jti'
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_id  UUID        NOT NULL,           -- the token family, survives rotation
    token_hash  TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Set when this token is rotated away or explicitly revoked.
    revoked_at  TIMESTAMPTZ,
    revoked_reason TEXT,
    replaced_by UUID REFERENCES refresh_tokens (id) ON DELETE SET NULL,

    -- Context for the session-management screen and for suspicious-login review.
    user_agent  TEXT,
    ip_address  INET,

    CONSTRAINT refresh_tokens_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT refresh_tokens_revoked_reason_valid CHECK (
        revoked_reason IS NULL OR revoked_reason IN ('rotated', 'logout', 'reuse_detected', 'password_changed', 'admin', 'expired')
    ),
    CONSTRAINT refresh_tokens_hash_length CHECK (char_length(token_hash) = 64)
);

CREATE UNIQUE INDEX refresh_tokens_token_hash_key ON refresh_tokens (token_hash);

-- The refresh path looks a token up by id and checks it is live; this composite
-- index serves that lookup and the "revoke the whole family" write.
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_user_idx    ON refresh_tokens (user_id, created_at DESC);

-- Supports the cleanup job that deletes expired rows.
CREATE INDEX refresh_tokens_expiry_idx  ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;
