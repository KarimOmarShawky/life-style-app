/**
 * Migration: 1727300001000_identity_and_sessions.cjs
 * 
 * Implements Section 6.3, 6.7, 6.9 & 6.11:
 * - Extension: citext
 * - Tables: users, auth_sessions, refresh_tokens, push_devices, categories, audit_logs
 * - Composite ownership keys, unique constraints, partial indexes, and role grants.
 */

exports.up = (pgm) => {
  // 1. Extensions
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "citext";');

  // 2. Users table (Section 6.3)
  pgm.sql(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email CITEXT NOT NULL UNIQUE CHECK (char_length(email) <= 254),
      password_hash TEXT NOT NULL,
      display_name VARCHAR(100) NOT NULL CHECK (char_length(trim(display_name)) > 0),
      timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
      locale VARCHAR(16) NOT NULL DEFAULT 'en',
      week_start SMALLINT NOT NULL DEFAULT 1 CHECK (week_start BETWEEN 1 AND 7),
      default_currency CHAR(3) NOT NULL CHECK (default_currency ~ '^[A-Z]{3}$'),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'pending_deletion')),
      email_verified_at TIMESTAMPTZ,
      password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ,
      deletion_scheduled_for TIMESTAMPTZ,
      push_show_titles BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((status = 'pending_deletion') = (deletion_scheduled_for IS NOT NULL))
    );

    CREATE INDEX idx_users_pending_deletion 
      ON users (status, deletion_scheduled_for) 
      WHERE status = 'pending_deletion';
  `);

  // 3. Auth Sessions table (Section 6.3)
  pgm.sql(`
    CREATE TABLE auth_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      absolute_expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      revoked_reason TEXT CHECK (revoked_reason IN (
        'logout', 'logout_all', 'password_change', 'password_reset', 
        'reuse_detected', 'account_disabled', 'account_deletion'
      )),
      device_platform TEXT NOT NULL CHECK (device_platform IN ('ios', 'android', 'unknown')),
      device_name VARCHAR(100),
      app_version VARCHAR(32),
      created_ip INET,
      CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
    );

    CREATE INDEX idx_auth_sessions_user_active 
      ON auth_sessions (user_id) 
      WHERE revoked_at IS NULL;

    CREATE INDEX idx_auth_sessions_expires 
      ON auth_sessions (absolute_expires_at);
  `);

  // 4. Refresh Tokens table (Section 6.3, ADR-002)
  pgm.sql(`
    CREATE TABLE refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      rotated_at TIMESTAMPTZ,
      replaced_by UUID REFERENCES refresh_tokens(id),
      revoked_at TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX idx_refresh_tokens_active_session 
      ON refresh_tokens (session_id) 
      WHERE rotated_at IS NULL AND revoked_at IS NULL;

    CREATE INDEX idx_refresh_tokens_expires 
      ON refresh_tokens (expires_at);
  `);

  // 5. Push Devices table (Section 6.3, ADR-040)
  pgm.sql(`
    CREATE TABLE push_devices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
      push_token TEXT NOT NULL UNIQUE CHECK (char_length(push_token) <= 512),
      app_version VARCHAR(32),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      disabled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_push_devices_user_active 
      ON push_devices (user_id) 
      WHERE disabled_at IS NULL;

    CREATE INDEX idx_push_devices_session 
      ON push_devices (session_id);
  `);

  // 6. Categories table (Section 6.7, needed for default category seeding on registration)
  pgm.sql(`
    CREATE TABLE categories (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
      name VARCHAR(60) NOT NULL CHECK (char_length(trim(name)) > 0),
      icon VARCHAR(40),
      color VARCHAR(7) CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id, kind)
    );

    CREATE UNIQUE INDEX idx_categories_user_kind_name 
      ON categories (user_id, kind, lower(name)) 
      WHERE archived_at IS NULL;
  `);

  // 7. Audit Logs table (Section 6.9, ADR-019)
  pgm.sql(`
    CREATE TABLE audit_logs (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system')),
      actor_user_id UUID,
      session_id UUID,
      event_type TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
      entity_type TEXT,
      entity_id UUID,
      request_id UUID,
      ip INET,
      user_agent VARCHAR(300),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
        jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 4096
      )
    );

    CREATE INDEX idx_audit_logs_actor_time 
      ON audit_logs (actor_user_id, occurred_at DESC);

    CREATE INDEX idx_audit_logs_event_time 
      ON audit_logs (event_type, occurred_at DESC);

    CREATE INDEX idx_audit_logs_time 
      ON audit_logs (occurred_at);
  `);

  // 8. Least-Privilege Grants (Section 6.11)
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON users, auth_sessions, refresh_tokens, push_devices, categories TO lifestyle_app;
    GRANT SELECT, INSERT ON audit_logs TO lifestyle_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lifestyle_app;

    GRANT DELETE ON audit_logs TO lifestyle_maintenance;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS audit_logs CASCADE;
    DROP TABLE IF EXISTS categories CASCADE;
    DROP TABLE IF EXISTS push_devices CASCADE;
    DROP TABLE IF EXISTS refresh_tokens CASCADE;
    DROP TABLE IF EXISTS auth_sessions CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP EXTENSION IF EXISTS citext;
  `);
};
