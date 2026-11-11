/**
 * Feature guide G5 + G1 (owner-approved 2026-11-10).
 *
 * product_events: content-free usage events for the Activation / D1 / D7 /
 * D30 funnel. A row holds only the event name, the server-recorded time,
 * the user's local calendar day at that time, the platform and the app
 * version. No titles, notes, identifiers of tasks/habits, device IDs, IP
 * addresses or free text. One row per user, event and local day: retries
 * are idempotent and the table stays small (at most six rows per user per
 * day).
 *
 * users.product_events_enabled: per-account opt-out (default on). Turning it
 * off deletes the account's events in the same transaction.
 * users.onboarding_completed_at: account-scoped first-run flag. Existing
 * accounts are backfilled so only accounts created after this migration see
 * onboarding.
 *
 * The table is owned by the account: it is erased by account deletion
 * (USER_OWNED_TABLES_IN_DELETE_ORDER), included in the JSON metadata export
 * and deliberately excluded from the versioned v1 archive file.
 *
 * Forward-only. Production (owner-managed Neon, no pgmigrations ledger) gets
 * the same statements from docs/analytics/sql/product-events-and-onboarding.sql;
 * a unit test keeps both copies identical.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE product_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_name TEXT NOT NULL CHECK (event_name IN ('app_opened', 'onboarding_started', 'onboarding_completed', 'onboarding_skipped', 'task_completed', 'habit_checked_in')),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      occurred_on DATE NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'unknown')),
      app_version TEXT CHECK (app_version IS NULL OR app_version ~ '^[0-9A-Za-z.+-]{1,32}$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT product_events_one_per_local_day UNIQUE (user_id, event_name, occurred_on)
    );
    CREATE INDEX idx_product_events_user_occurred ON product_events (user_id, occurred_at);
    CREATE INDEX idx_product_events_name_occurred ON product_events (event_name, occurred_at);
    DO $grant$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
        GRANT SELECT, INSERT, DELETE ON product_events TO lifestyle_app;
      END IF;
    END $grant$;

    ALTER TABLE users ADD COLUMN product_events_enabled BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
    UPDATE users SET onboarding_completed_at = created_at WHERE onboarding_completed_at IS NULL;
  `);
};

exports.down = () => {
  throw new Error('Product events migration is forward-only');
};
