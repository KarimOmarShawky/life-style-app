-- Projects, tasks, and timer sessions (ERD: Project, Task, TimerSession).
--
-- Every row is scoped to a user. The user_id column on each table is what makes
-- ownership checkable in the same query that fetches the row, which is how IDOR
-- is prevented structurally rather than by remembering a check (spec section 16).

CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT projects_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT projects_name_length    CHECK (char_length(name) <= 120)
);

-- Composite and user-first: every listing query filters by user_id, so an index
-- that does not lead with it cannot be used for that filter.
CREATE INDEX projects_user_created_idx ON projects (user_id, created_at DESC);

-- A user cannot have two projects with the same name. Enforced in the database
-- because the check-then-insert version races (spec section 32).
CREATE UNIQUE INDEX projects_user_name_key ON projects (user_id, lower(name));


CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    project_id      UUID REFERENCES projects (id) ON DELETE SET NULL,
    title           TEXT        NOT NULL,
    description     TEXT,
    due_date        TIMESTAMPTZ,
    priority        TEXT        NOT NULL DEFAULT 'medium',
    status          TEXT        NOT NULL DEFAULT 'todo',

    -- A recurring task is distinct from a habit (improvement deck, slide 8).
    is_recurring    BOOLEAN     NOT NULL DEFAULT FALSE,
    recurrence_rule TEXT,

    has_timer       BOOLEAN     NOT NULL DEFAULT FALSE,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT tasks_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT tasks_title_length    CHECK (char_length(title) <= 200),
    CONSTRAINT tasks_priority_valid  CHECK (priority IN ('low', 'medium', 'high')),
    CONSTRAINT tasks_status_valid    CHECK (status IN ('todo', 'in_progress', 'done')),
    -- The ERD says "is_recurring boolean + recurrence_rule if true". Expressing
    -- that as a constraint stops a half-configured recurring task existing.
    CONSTRAINT tasks_recurrence_rule_present CHECK (
        (is_recurring AND recurrence_rule IS NOT NULL AND btrim(recurrence_rule) <> '')
        OR (NOT is_recurring AND recurrence_rule IS NULL)
    ),
    CONSTRAINT tasks_completed_matches_status CHECK (
        (status = 'done' AND completed_at IS NOT NULL)
        OR (status <> 'done' AND completed_at IS NULL)
    )
);

-- The Home dashboard asks for "today's tasks and overdue items" (FR-24), which
-- is a filter on user plus due_date over incomplete rows. Partial, because done
-- tasks are never in that answer and excluding them keeps the index small.
CREATE INDEX tasks_user_due_open_idx ON tasks (user_id, due_date)
    WHERE status <> 'done';

CREATE INDEX tasks_user_status_idx  ON tasks (user_id, status, created_at DESC);
CREATE INDEX tasks_project_idx      ON tasks (project_id) WHERE project_id IS NOT NULL;


-- One task has many timer sessions (ERD note: the separate table is retained
-- precisely because of that cardinality).
CREATE TABLE timer_sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID        NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_time   TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT timer_sessions_end_after_start CHECK (end_time IS NULL OR end_time > start_time)
);

CREATE INDEX timer_sessions_task_idx ON timer_sessions (task_id, start_time DESC);

-- At most one running session per task. A partial unique index expresses
-- "unique among rows where end_time IS NULL", which is exactly the rule, and
-- makes a double-tap on Start impossible rather than merely unlikely.
CREATE UNIQUE INDEX timer_sessions_one_running_per_task
    ON timer_sessions (task_id) WHERE end_time IS NULL;

CREATE TRIGGER projects_set_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tasks_set_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
