/**
 * Migration 1727300002000_core_entities
 *
 * Implements Section 6.1–6.9: All remaining 16 core entities for Phase P3:
 * - pg_trgm extension
 * - goals, milestones
 * - projects, recurring_tasks, habits, recurrences
 * - tasks, timer_sessions, habit_checkins
 * - notes, note_links
 * - events
 * - subscriptions, transactions, budgets
 * - reminders
 * - update_updated_at_column triggers
 * - Role grants (lifestyle_app, lifestyle_maintenance)
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Extensions
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pg_trgm";`);

  // 2. Updated_at trigger function and immutable array helper for notes tsvector
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION immutable_array_to_string(arr text[], sep text)
    RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
      SELECT array_to_string(arr, sep, '');
    $$;
  `);

  // Attach trigger to users and categories from previous migration
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
    CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS trg_categories_updated_at ON categories;
    CREATE TRIGGER trg_categories_updated_at
      BEFORE UPDATE ON categories
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  // 3. goals (§6.4)
  pgm.sql(`
    CREATE TABLE goals (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL CHECK (char_length(btrim(title)) >= 1),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 5000),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'achieved', 'abandoned')),
      progress_type TEXT NOT NULL CHECK (progress_type IN ('milestones', 'numeric')),
      target_value NUMERIC(18,4),
      current_value NUMERIC(18,4),
      unit VARCHAR(30),
      start_date DATE,
      target_date DATE,
      achieved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      CHECK (start_date IS NULL OR target_date IS NULL OR start_date <= target_date),
      CHECK ((status = 'achieved') = (achieved_at IS NOT NULL)),
      CHECK (
        (progress_type = 'numeric' AND target_value > 0 AND current_value >= 0)
        OR
        (progress_type = 'milestones' AND target_value IS NULL AND current_value IS NULL AND unit IS NULL)
      )
    );

    CREATE TRIGGER trg_goals_updated_at
      BEFORE UPDATE ON goals
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE INDEX idx_goals_user_status ON goals (user_id, status) WHERE deleted_at IS NULL;
    CREATE INDEX idx_goals_search ON goals USING gin (to_tsvector('simple', title || ' ' || coalesce(description, '')));
    CREATE INDEX idx_goals_trgm ON goals USING gin (title gin_trgm_ops);
  `);

  // 4. milestones (§6.4)
  pgm.sql(`
    CREATE TABLE milestones (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      goal_id UUID NOT NULL,
      title VARCHAR(200) NOT NULL CHECK (char_length(btrim(title)) >= 1),
      due_date DATE,
      completed_at TIMESTAMPTZ,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id) ON DELETE CASCADE
    );

    CREATE TRIGGER trg_milestones_updated_at
      BEFORE UPDATE ON milestones
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE INDEX idx_milestones_goal_sort ON milestones (goal_id, sort_order);
  `);

  // 5. projects (§6.4)
  pgm.sql(`
    CREATE TABLE projects (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL CHECK (char_length(btrim(name)) >= 1),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 5000),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'completed', 'archived')),
      color VARCHAR(7) CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
      goal_id UUID,
      due_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id) ON DELETE SET NULL (goal_id)
    );

    CREATE TRIGGER trg_projects_updated_at
      BEFORE UPDATE ON projects
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE INDEX idx_projects_user_status ON projects (user_id, status) WHERE deleted_at IS NULL;
    CREATE INDEX idx_projects_search ON projects USING gin (to_tsvector('simple', name || ' ' || coalesce(description, '')));
    CREATE INDEX idx_projects_trgm ON projects USING gin (name gin_trgm_ops);
  `);

  // 6. recurring_tasks (§6.4)
  pgm.sql(`
    CREATE TABLE recurring_tasks (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(300) NOT NULL CHECK (char_length(btrim(title)) >= 1),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 10000),
      project_id UUID,
      priority SMALLINT NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
      estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR (estimate_minutes BETWEEN 1 AND 1440)),
      due_time TIME,
      reminder_offset_minutes INTEGER CHECK (reminder_offset_minutes IS NULL OR (reminder_offset_minutes BETWEEN 0 AND 43200)),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
      generated_through DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects (id, user_id) ON DELETE SET NULL (project_id)
    );

    CREATE TRIGGER trg_recurring_tasks_updated_at
      BEFORE UPDATE ON recurring_tasks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE INDEX idx_recurring_tasks_generation ON recurring_tasks (status, generated_through) WHERE deleted_at IS NULL;
    CREATE INDEX idx_recurring_tasks_user ON recurring_tasks (user_id);
  `);

  // 7. habits (§6.5)
  pgm.sql(`
    CREATE TABLE habits (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL CHECK (char_length(btrim(name)) >= 1),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
      start_date DATE NOT NULL,
      reminder_time TIME,
      color VARCHAR(7) CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
      goal_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id) ON DELETE SET NULL (goal_id)
    );

    CREATE TRIGGER trg_habits_updated_at
      BEFORE UPDATE ON habits
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE INDEX idx_habits_user_status ON habits (user_id, status) WHERE deleted_at IS NULL;
    CREATE INDEX idx_habits_trgm ON habits USING gin (name gin_trgm_ops);
  `);

  // 8. recurrences (§6.4)
  pgm.sql(`
    CREATE TABLE recurrences (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recurring_task_id UUID UNIQUE,
      habit_id UUID UNIQUE,
      freq TEXT NOT NULL CHECK (freq IN ('daily', 'weekly', 'monthly', 'yearly')),
      interval SMALLINT NOT NULL DEFAULT 1 CHECK (interval BETWEEN 1 AND 365),
      by_weekday SMALLINT[],
      by_month_day SMALLINT CHECK (by_month_day IS NULL OR (by_month_day BETWEEN 1 AND 31 OR by_month_day = -1)),
      by_month SMALLINT CHECK (by_month IS NULL OR (by_month BETWEEN 1 AND 12)),
      start_date DATE NOT NULL,
      end_date DATE,
      occurrence_limit INTEGER CHECK (occurrence_limit IS NULL OR occurrence_limit > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (recurring_task_id, user_id) REFERENCES recurring_tasks (id, user_id) ON DELETE CASCADE,
      FOREIGN KEY (habit_id, user_id) REFERENCES habits (id, user_id) ON DELETE CASCADE,
      CHECK (num_nonnulls(recurring_task_id, habit_id) = 1),
      CHECK (end_date IS NULL OR occurrence_limit IS NULL),
      CHECK (end_date IS NULL OR end_date >= start_date),
      CHECK (
        (freq = 'daily' AND by_weekday IS NULL AND by_month_day IS NULL AND by_month IS NULL) OR
        (freq = 'weekly' AND by_weekday IS NOT NULL AND by_month_day IS NULL AND by_month IS NULL) OR
        (freq = 'monthly' AND by_month_day IS NOT NULL AND by_weekday IS NULL AND by_month IS NULL) OR
        (freq = 'yearly' AND by_month IS NOT NULL AND by_month_day IS NOT NULL AND by_weekday IS NULL)
      )
    );

    CREATE TRIGGER trg_recurrences_updated_at
      BEFORE UPDATE ON recurrences
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  // 9. tasks (§6.4)
  pgm.sql(`
    CREATE TABLE tasks (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(300) NOT NULL CHECK (char_length(btrim(title)) >= 1),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 10000),
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
      priority SMALLINT NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
      due_date DATE,
      due_time TIME,
      planned_date DATE,
      is_focus BOOLEAN NOT NULL DEFAULT false,
      estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR (estimate_minutes BETWEEN 1 AND 1440)),
      project_id UUID,
      recurring_task_id UUID,
      occurrence_date DATE,
      is_customized BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMPTZ,
      search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || coalesce(description, ''))) STORED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects (id, user_id) ON DELETE SET NULL (project_id),
      FOREIGN KEY (recurring_task_id, user_id) REFERENCES recurring_tasks (id, user_id) ON DELETE SET NULL (recurring_task_id),
      CHECK (due_time IS NULL OR due_date IS NOT NULL),
      CHECK (NOT is_focus OR planned_date IS NOT NULL),
      CHECK (recurring_task_id IS NULL OR occurrence_date IS NOT NULL),
      CHECK ((status = 'done') = (completed_at IS NOT NULL))
    );

    CREATE TRIGGER trg_tasks_updated_at
      BEFORE UPDATE ON tasks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE UNIQUE INDEX idx_tasks_recurring_occurrence 
      ON tasks (recurring_task_id, occurrence_date) 
      WHERE recurring_task_id IS NOT NULL;

    CREATE UNIQUE INDEX idx_tasks_one_focus_per_day 
      ON tasks (user_id, planned_date) 
      WHERE is_focus AND deleted_at IS NULL;

    CREATE INDEX idx_tasks_user_status_due 
      ON tasks (user_id, status, due_date) 
      WHERE deleted_at IS NULL;

    CREATE INDEX idx_tasks_user_project 
      ON tasks (user_id, project_id) 
      WHERE deleted_at IS NULL;

    CREATE INDEX idx_tasks_user_planned 
      ON tasks (user_id, planned_date) 
      WHERE deleted_at IS NULL AND planned_date IS NOT NULL;

    CREATE INDEX idx_tasks_user_completed 
      ON tasks (user_id, completed_at) 
      WHERE status = 'done' AND deleted_at IS NULL;

    CREATE INDEX idx_tasks_search 
      ON tasks USING gin (search_vector);

    CREATE INDEX idx_tasks_trgm 
      ON tasks USING gin (title gin_trgm_ops);

    CREATE INDEX idx_tasks_deleted 
      ON tasks (deleted_at) 
      WHERE deleted_at IS NOT NULL;
  `);

  // 10. timer_sessions (§6.4)
  pgm.sql(`
    CREATE TABLE timer_sessions (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id UUID NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      mode TEXT NOT NULL DEFAULT 'stopwatch' CHECK (mode IN ('stopwatch', 'countdown')),
      planned_seconds INTEGER CHECK (planned_seconds IS NULL OR (planned_seconds BETWEEN 60 AND 43200)),
      end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('stopped', 'completed', 'auto_closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (task_id, user_id) REFERENCES tasks (id, user_id) ON DELETE CASCADE,
      CHECK (ended_at IS NULL OR ended_at > started_at),
      CHECK ((mode = 'countdown') = (planned_seconds IS NOT NULL)),
      CHECK ((ended_at IS NULL) = (end_reason IS NULL))
    );

    CREATE TRIGGER trg_timer_sessions_updated_at
      BEFORE UPDATE ON timer_sessions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE UNIQUE INDEX idx_timer_sessions_one_running 
      ON timer_sessions (user_id) 
      WHERE ended_at IS NULL;

    CREATE INDEX idx_timer_sessions_user_started 
      ON timer_sessions (user_id, started_at);

    CREATE INDEX idx_timer_sessions_task_started 
      ON timer_sessions (task_id, started_at);
  `);

  // 11. habit_checkins (§6.5)
  pgm.sql(`
    CREATE TABLE habit_checkins (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      habit_id UUID NOT NULL,
      checkin_date DATE NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('done', 'skipped')),
      note VARCHAR(500),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      UNIQUE (habit_id, checkin_date),
      FOREIGN KEY (habit_id, user_id) REFERENCES habits (id, user_id) ON DELETE CASCADE
    );

    CREATE TRIGGER trg_habit_checkins_updated_at
      BEFORE UPDATE ON habit_checkins
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE INDEX idx_habit_checkins_user_date 
      ON habit_checkins (user_id, checkin_date);
  `);

  // 12. notes (§6.6)
  pgm.sql(`
    CREATE TABLE notes (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200),
      body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 100000),
      tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
      is_pinned BOOLEAN NOT NULL DEFAULT false,
      search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(title, '') || ' ' || body || ' ' || immutable_array_to_string(tags, ' '))
      ) STORED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      CHECK (title IS NOT NULL OR char_length(body) > 0)
    );

    CREATE TRIGGER trg_notes_updated_at
      BEFORE UPDATE ON notes
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE INDEX idx_notes_user_pinned 
      ON notes (user_id, is_pinned DESC, updated_at DESC) 
      WHERE deleted_at IS NULL;

    CREATE INDEX idx_notes_tags 
      ON notes USING gin (tags);

    CREATE INDEX idx_notes_search 
      ON notes USING gin (search_vector);

    CREATE INDEX idx_notes_trgm 
      ON notes USING gin (title gin_trgm_ops);
  `);

  // 13. events (§6.8)
  pgm.sql(`
    CREATE TABLE events (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL CHECK (char_length(btrim(title)) >= 1),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 5000),
      location VARCHAR(300),
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      all_day BOOLEAN NOT NULL DEFAULT false,
      timezone VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      CHECK (end_at >= start_at)
    );

    CREATE TRIGGER trg_events_updated_at
      BEFORE UPDATE ON events
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE INDEX idx_events_user_start 
      ON events (user_id, start_at) 
      WHERE deleted_at IS NULL;

    CREATE INDEX idx_events_trgm 
      ON events USING gin (title gin_trgm_ops);
  `);

  // 14. note_links (§6.6)
  pgm.sql(`
    CREATE TABLE note_links (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id UUID NOT NULL,
      task_id UUID,
      project_id UUID,
      goal_id UUID,
      habit_id UUID,
      event_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (note_id, user_id) REFERENCES notes (id, user_id) ON DELETE CASCADE,
      FOREIGN KEY (task_id, user_id) REFERENCES tasks (id, user_id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, user_id) REFERENCES projects (id, user_id) ON DELETE CASCADE,
      FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id) ON DELETE CASCADE,
      FOREIGN KEY (habit_id, user_id) REFERENCES habits (id, user_id) ON DELETE CASCADE,
      FOREIGN KEY (event_id, user_id) REFERENCES events (id, user_id) ON DELETE CASCADE,
      CHECK (num_nonnulls(task_id, project_id, goal_id, habit_id, event_id) = 1)
    );

    CREATE UNIQUE INDEX idx_note_links_task ON note_links (note_id, task_id) WHERE task_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_note_links_project ON note_links (note_id, project_id) WHERE project_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_note_links_goal ON note_links (note_id, goal_id) WHERE goal_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_note_links_habit ON note_links (note_id, habit_id) WHERE habit_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_note_links_event ON note_links (note_id, event_id) WHERE event_id IS NOT NULL;
  `);

  // 15. subscriptions (§6.7)
  pgm.sql(`
    CREATE TABLE subscriptions (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL CHECK (char_length(btrim(name)) >= 1),
      amount NUMERIC(19,4) NOT NULL CHECK (amount > 0),
      currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      billing_unit TEXT NOT NULL CHECK (billing_unit IN ('week', 'month', 'year')),
      billing_interval SMALLINT NOT NULL DEFAULT 1 CHECK (billing_interval BETWEEN 1 AND 12),
      anchor_date DATE NOT NULL,
      next_billing_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
      cancelled_on DATE,
      category_kind TEXT GENERATED ALWAYS AS ('expense') STORED,
      category_id UUID,
      reminder_days_before SMALLINT CHECK (reminder_days_before IS NULL OR (reminder_days_before BETWEEN 0 AND 30)),
      notes VARCHAR(1000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (category_id, user_id, category_kind) REFERENCES categories (id, user_id, kind) ON DELETE RESTRICT,
      CHECK ((status = 'cancelled') = (cancelled_on IS NOT NULL))
    );

    CREATE TRIGGER trg_subscriptions_updated_at
      BEFORE UPDATE ON subscriptions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE INDEX idx_subscriptions_user_status_next 
      ON subscriptions (user_id, status, next_billing_date) 
      WHERE deleted_at IS NULL;

    CREATE INDEX idx_subscriptions_trgm 
      ON subscriptions USING gin (name gin_trgm_ops);
  `);

  // 16. transactions (§6.7)
  pgm.sql(`
    CREATE TABLE transactions (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
      amount NUMERIC(19,4) NOT NULL CHECK (amount > 0),
      currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      occurred_on DATE NOT NULL,
      category_id UUID,
      description VARCHAR(500),
      merchant VARCHAR(150),
      subscription_id UUID,
      billing_date DATE,
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
      idempotency_key UUID,
      idempotency_fingerprint BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (category_id, user_id, kind) REFERENCES categories (id, user_id, kind) ON DELETE RESTRICT,
      FOREIGN KEY (subscription_id, user_id) REFERENCES subscriptions (id, user_id) ON DELETE SET NULL (subscription_id),
      CHECK (subscription_id IS NULL OR billing_date IS NOT NULL),
      CHECK (subscription_id IS NULL OR kind = 'expense')
    );

    CREATE TRIGGER trg_transactions_updated_at
      BEFORE UPDATE ON transactions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE UNIQUE INDEX idx_transactions_user_idempotency 
      ON transactions (user_id, idempotency_key) 
      WHERE idempotency_key IS NOT NULL;

    CREATE UNIQUE INDEX idx_transactions_sub_billing 
      ON transactions (subscription_id, billing_date) 
      WHERE subscription_id IS NOT NULL AND deleted_at IS NULL;

    CREATE INDEX idx_transactions_user_occurred 
      ON transactions (user_id, occurred_on DESC, id DESC) 
      WHERE deleted_at IS NULL;

    CREATE INDEX idx_transactions_reports 
      ON transactions (user_id, currency, occurred_on) 
      INCLUDE (kind, amount, category_id) 
      WHERE deleted_at IS NULL;

    CREATE INDEX idx_transactions_user_category 
      ON transactions (user_id, category_id, occurred_on) 
      WHERE deleted_at IS NULL;

    CREATE INDEX idx_transactions_trgm_merchant 
      ON transactions USING gin (merchant gin_trgm_ops);

    CREATE INDEX idx_transactions_trgm_description 
      ON transactions USING gin (description gin_trgm_ops);
  `);

  // 17. budgets (§6.7)
  pgm.sql(`
    CREATE TABLE budgets (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_kind TEXT GENERATED ALWAYS AS ('expense') STORED,
      category_id UUID,
      amount_limit NUMERIC(19,4) NOT NULL CHECK (amount_limit > 0),
      currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (category_id, user_id, category_kind) REFERENCES categories (id, user_id, kind) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_budgets_updated_at
      BEFORE UPDATE ON budgets
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE UNIQUE INDEX idx_budgets_unique_period 
      ON budgets (user_id, category_id, currency, period) NULLS NOT DISTINCT 
      WHERE deleted_at IS NULL;
  `);

  // 18. reminders (§6.8)
  pgm.sql(`
    CREATE TABLE reminders (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id UUID,
      habit_id UUID,
      event_id UUID,
      subscription_id UUID,
      entity_type TEXT GENERATED ALWAYS AS (
        CASE 
          WHEN task_id IS NOT NULL THEN 'task'
          WHEN habit_id IS NOT NULL THEN 'habit'
          WHEN event_id IS NOT NULL THEN 'event'
          ELSE 'subscription'
        END
      ) STORED,
      entity_id UUID GENERATED ALWAYS AS (
        COALESCE(task_id, habit_id, event_id, subscription_id)
      ) STORED,
      source TEXT NOT NULL CHECK (source IN ('user', 'system')),
      remind_at TIMESTAMPTZ NOT NULL,
      offset_minutes INTEGER CHECK (offset_minutes IS NULL OR (offset_minutes BETWEEN 0 AND 43200)),
      channel TEXT NOT NULL CHECK (channel IN ('push', 'in_app', 'email')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
      next_attempt_at TIMESTAMPTZ,
      attempt_count SMALLINT NOT NULL DEFAULT 0,
      processing_started_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      last_error_code VARCHAR(50),
      last_error_message VARCHAR(500),
      dedupe_key VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, user_id),
      UNIQUE (id, user_id),
      FOREIGN KEY (task_id, user_id) REFERENCES tasks (id, user_id) ON DELETE CASCADE,
      FOREIGN KEY (habit_id, user_id) REFERENCES habits (id, user_id) ON DELETE CASCADE,
      FOREIGN KEY (event_id, user_id) REFERENCES events (id, user_id) ON DELETE CASCADE,
      FOREIGN KEY (subscription_id, user_id) REFERENCES subscriptions (id, user_id) ON DELETE CASCADE,
      CHECK (num_nonnulls(task_id, habit_id, event_id, subscription_id) = 1),
      CHECK (status <> 'pending' OR next_attempt_at IS NOT NULL),
      CHECK (status <> 'sent' OR sent_at IS NOT NULL)
    );

    CREATE TRIGGER trg_reminders_updated_at
      BEFORE UPDATE ON reminders
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE INDEX idx_reminders_dispatcher 
      ON reminders (next_attempt_at) 
      WHERE status = 'pending';

    CREATE INDEX idx_reminders_user_remind 
      ON reminders (user_id, remind_at DESC);

    CREATE INDEX idx_reminders_task ON reminders (task_id);
    CREATE INDEX idx_reminders_habit ON reminders (habit_id);
    CREATE INDEX idx_reminders_event ON reminders (event_id);
    CREATE INDEX idx_reminders_subscription ON reminders (subscription_id);

    CREATE UNIQUE INDEX idx_reminders_dedupe 
      ON reminders (user_id, dedupe_key) 
      WHERE dedupe_key IS NOT NULL;
  `);

  // 19. Role grants to lifestyle_app
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON 
      goals, milestones, projects, recurring_tasks, habits, recurrences,
      tasks, timer_sessions, habit_checkins, notes, note_links, events,
      subscriptions, transactions, budgets, reminders
    TO lifestyle_app;

    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lifestyle_app;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS reminders CASCADE;
    DROP TABLE IF EXISTS budgets CASCADE;
    DROP TABLE IF EXISTS transactions CASCADE;
    DROP TABLE IF EXISTS subscriptions CASCADE;
    DROP TABLE IF EXISTS note_links CASCADE;
    DROP TABLE IF EXISTS events CASCADE;
    DROP TABLE IF EXISTS notes CASCADE;
    DROP TABLE IF EXISTS habit_checkins CASCADE;
    DROP TABLE IF EXISTS timer_sessions CASCADE;
    DROP TABLE IF EXISTS tasks CASCADE;
    DROP TABLE IF EXISTS recurrences CASCADE;
    DROP TABLE IF EXISTS habits CASCADE;
    DROP TABLE IF EXISTS recurring_tasks CASCADE;
    DROP TABLE IF EXISTS projects CASCADE;
    DROP TABLE IF EXISTS milestones CASCADE;
    DROP TABLE IF EXISTS goals CASCADE;
    DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
    DROP FUNCTION IF EXISTS immutable_array_to_string CASCADE;
    DROP EXTENSION IF EXISTS pg_trgm CASCADE;
  `);
};
