CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE EXTENSION IF NOT EXISTS "citext";

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

-- role-conditional grant
DO $body$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON users, auth_sessions, refresh_tokens, push_devices, categories TO lifestyle_app;
    GRANT SELECT, INSERT ON audit_logs TO lifestyle_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lifestyle_app;

    END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_maintenance') THEN
    GRANT DELETE ON audit_logs TO lifestyle_maintenance;
  END IF;
END $body$;

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

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

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
    CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS trg_categories_updated_at ON categories;
    CREATE TRIGGER trg_categories_updated_at
      BEFORE UPDATE ON categories
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

CREATE TABLE timer_sessions (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id UUID,
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

    CREATE INDEX idx_notes_body_trgm
      ON notes USING gin (body gin_trgm_ops);

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

CREATE TABLE ingest_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
      token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX idx_ingest_tokens_active_session
      ON ingest_tokens (session_id)
      WHERE revoked_at IS NULL;

DO $body$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON ingest_tokens TO lifestyle_app; END IF; END $body$;

-- role-conditional grant
DO $body$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON 
      goals, milestones, projects, recurring_tasks, habits, recurrences,
      tasks, timer_sessions, habit_checkins, notes, note_links, events,
      subscriptions, transactions, budgets, reminders
    TO lifestyle_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lifestyle_app; END IF; END $body$;