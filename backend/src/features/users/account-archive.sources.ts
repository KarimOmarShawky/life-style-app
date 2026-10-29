/** Explicit version-1 projections. Never infer export columns from SELECT * or schema introspection. */
const timestamps = 'created_at, updated_at';
const versioned = `${timestamps}, deleted_at, version`;
export const ACCOUNT_ARCHIVE_SOURCES = [
  {
    section: 'profile',
    table: 'users',
    owner: 'id',
    columns: `id, email, display_name, timezone, locale, week_start, default_currency, status, email_verified_at, password_changed_at, last_login_at, deletion_scheduled_for, push_show_titles, ${timestamps}`
  },
  {
    section: 'sessions',
    table: 'auth_sessions',
    owner: 'user_id',
    columns:
      'id, created_at, last_used_at, absolute_expires_at, revoked_at, revoked_reason, device_platform, device_name, app_version, created_ip'
  },
  {
    section: 'pushDevices',
    table: 'push_devices',
    owner: 'user_id',
    columns: 'id, session_id, platform, app_version, last_seen_at, disabled_at, created_at'
  },
  {
    section: 'ingestDevices',
    table: 'ingest_tokens',
    owner: 'user_id',
    columns: 'id, session_id, created_at, last_used_at, revoked_at'
  },
  {
    section: 'categories',
    table: 'categories',
    owner: 'user_id',
    columns: `id, kind, name, icon, color, archived_at, ${timestamps}, version`
  },
  {
    section: 'goals',
    table: 'goals',
    owner: 'user_id',
    columns: `id, title, description, status, progress_type, target_value::text AS target_value, current_value::text AS current_value, unit, start_date, target_date, achieved_at, ${versioned}`
  },
  {
    section: 'milestones',
    table: 'milestones',
    owner: 'user_id',
    columns: `id, goal_id, title, due_date, completed_at, sort_order, ${timestamps}, version`
  },
  {
    section: 'projects',
    table: 'projects',
    owner: 'user_id',
    columns: `id, name, description, status, color, goal_id, due_date, ${versioned}`
  },
  {
    section: 'recurringTasks',
    table: 'recurring_tasks',
    owner: 'user_id',
    columns: `id, title, description, project_id, priority, estimate_minutes, due_time, reminder_offset_minutes, status, generated_through, ${versioned}`
  },
  {
    section: 'habits',
    table: 'habits',
    owner: 'user_id',
    columns: `id, name, description, status, start_date, reminder_time, color, goal_id, ${versioned}`
  },
  {
    section: 'recurrences',
    table: 'recurrences',
    owner: 'user_id',
    columns: `id, recurring_task_id, habit_id, freq, interval, by_weekday, by_month_day, by_month, start_date, end_date, occurrence_limit, ${timestamps}`
  },
  {
    section: 'tasks',
    table: 'tasks',
    owner: 'user_id',
    columns: `id, title, description, status, priority, due_date, due_time, planned_date, is_focus, estimate_minutes, project_id, recurring_task_id, occurrence_date, is_customized, completed_at, ${versioned}`
  },
  {
    section: 'timerSessions',
    table: 'timer_sessions',
    owner: 'user_id',
    columns: `id, task_id, started_at, ended_at, mode, planned_seconds, end_reason, ${timestamps}`
  },
  {
    section: 'habitCheckins',
    table: 'habit_checkins',
    owner: 'user_id',
    columns: `id, habit_id, checkin_date, status, note, ${timestamps}`
  },
  {
    section: 'notes',
    table: 'notes',
    owner: 'user_id',
    columns: `id, title, body, tags, is_pinned, ${versioned}`
  },
  {
    section: 'events',
    table: 'events',
    owner: 'user_id',
    columns: `id, title, description, location, start_at, end_at, all_day, timezone, ${versioned}`
  },
  {
    section: 'noteLinks',
    table: 'note_links',
    owner: 'user_id',
    columns: 'id, note_id, task_id, project_id, goal_id, habit_id, event_id, created_at'
  },
  {
    section: 'subscriptions',
    table: 'subscriptions',
    owner: 'user_id',
    columns: `id, name, amount::text AS amount, currency, billing_unit, billing_interval, anchor_date, next_billing_date, status, cancelled_on, category_kind, category_id, reminder_days_before, notes, ${versioned}`
  },
  {
    section: 'transactions',
    table: 'transactions',
    owner: 'user_id',
    columns: `id, kind, amount::text AS amount, currency, occurred_on, category_id, description, merchant, subscription_id, billing_date, source, idempotency_key, ${versioned}`
  },
  {
    section: 'budgets',
    table: 'budgets',
    owner: 'user_id',
    columns: `id, category_kind, category_id, amount_limit::text AS amount_limit, currency, period, ${versioned}`
  },
  {
    section: 'reminders',
    table: 'reminders',
    owner: 'user_id',
    columns: `id, task_id, habit_id, event_id, subscription_id, entity_type, entity_id, source, remind_at, offset_minutes, channel, status, next_attempt_at, attempt_count, sent_at, failed_at, ${timestamps}`
  }
] as const;

/**
 * Owned tables that are deliberately outside the versioned v1 archive contract
 * (V-06).
 *
 * `password_reset_requests` is erased with the account and bounded by its own
 * retention window, but adding a section to `archiveSectionsV1` would make every
 * already-installed client reject the export (the verifier pins the section
 * order). Reset records are therefore a documented exclusion, not an oversight:
 * `tests/unit/account-archive.test.ts` asserts that they are owned and purged.
 */
export const ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS = ['password_reset_requests'] as const;

export const ACCOUNT_ARCHIVE_EXCLUSIONS = [
  'password hashes and authentication/refresh/ingest/push token material',
  'audit logs, infrastructure queues/caches, derived search vectors',
  'internal delivery diagnostics and idempotency fingerprints',
  // Password-reset request records are erased with the account (V-06) and the
  // bounded retention window, but they are not part of the versioned v1 archive
  // contract: adding a section would make older clients reject the export.
  'password-reset request records and their network metadata (IP address and user agent)',
  'device-only data, external-provider data and already purged records'
] as const;
