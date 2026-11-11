/**
 * Feature guide G2 (ADR-046, owner decisions 2026-11-11).
 *
 * notification_preferences: at most one row per account with the settings of
 * the shared notification policy. No row means the defaults: notifications
 * on, no quiet hours, no daily limit, no low-priority summary, and alarms
 * wait for quiet hours to end. Quiet hours are local minutes after midnight
 * in the account time zone (users.timezone). No notification text is stored.
 *
 * The row is owned by the account: it is erased by account deletion
 * (USER_OWNED_TABLES_IN_DELETE_ORDER, and ON DELETE CASCADE), included in the
 * JSON metadata export and deliberately excluded from the versioned v1
 * archive file.
 *
 * Forward-only. Production (owner-managed Neon, no pgmigrations ledger) gets
 * the same statements from docs/notifications/sql/notification-preferences.sql;
 * a unit test keeps both copies identical.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE notification_preferences (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      notifications_enabled BOOLEAN NOT NULL DEFAULT true,
      quiet_start_minute SMALLINT CHECK (quiet_start_minute IS NULL OR quiet_start_minute BETWEEN 0 AND 1439),
      quiet_end_minute SMALLINT CHECK (quiet_end_minute IS NULL OR quiet_end_minute BETWEEN 0 AND 1439),
      daily_cap SMALLINT CHECK (daily_cap IS NULL OR daily_cap BETWEEN 1 AND 50),
      digest_enabled BOOLEAN NOT NULL DEFAULT false,
      critical_breaks_quiet BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT notification_preferences_quiet_pair CHECK ((quiet_start_minute IS NULL) = (quiet_end_minute IS NULL)),
      CONSTRAINT notification_preferences_quiet_distinct CHECK (quiet_start_minute IS NULL OR quiet_start_minute <> quiet_end_minute)
    );
    DO $grant$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO lifestyle_app;
      END IF;
    END $grant$;
  `);
};

exports.down = () => {
  throw new Error('Notification preferences migration is forward-only');
};
