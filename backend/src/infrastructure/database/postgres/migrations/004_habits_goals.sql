-- Habits, habit logs, goals and milestones (ERD: Habit, HabitLog, Goal, Milestone).

CREATE TABLE habits (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title      TEXT        NOT NULL,
    frequency  TEXT        NOT NULL DEFAULT 'daily',
    is_archived BOOLEAN    NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT habits_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT habits_title_length    CHECK (char_length(title) <= 200),
    CONSTRAINT habits_frequency_valid CHECK (frequency IN ('daily', 'weekly', 'custom'))
);

CREATE INDEX habits_user_idx ON habits (user_id, created_at DESC) WHERE NOT is_archived;


-- One row per habit per day, which is what makes a streak a simple ordered scan
-- rather than a recomputation over an event log (FR-10).
CREATE TABLE habit_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    habit_id   UUID        NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    log_date   DATE        NOT NULL,
    completed  BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The uniqueness rule from the ERD ("one row per day"), enforced by the database.
-- Without it, two taps on "mark done" create two rows and the streak count is wrong.
CREATE UNIQUE INDEX habit_logs_habit_date_key ON habit_logs (habit_id, log_date);

-- Streak calculation walks backwards from today over completed days.
CREATE INDEX habit_logs_streak_idx ON habit_logs (habit_id, log_date DESC) WHERE completed;
CREATE INDEX habit_logs_user_date_idx ON habit_logs (user_id, log_date DESC);


CREATE TABLE goals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title       TEXT        NOT NULL,
    description TEXT,
    target_date DATE,
    status      TEXT        NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT goals_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT goals_title_length    CHECK (char_length(title) <= 200),
    CONSTRAINT goals_status_valid    CHECK (status IN ('active', 'achieved', 'abandoned'))
);

CREATE INDEX goals_user_idx ON goals (user_id, target_date NULLS LAST);


-- Milestone -> Task is 0..1 per the ERD: a milestone may be a plain checklist
-- item, or be backed by a real task.
CREATE TABLE milestones (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id    UUID        NOT NULL REFERENCES goals (id) ON DELETE CASCADE,
    task_id    UUID REFERENCES tasks (id) ON DELETE SET NULL,
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title      TEXT        NOT NULL,
    is_done    BOOLEAN     NOT NULL DEFAULT FALSE,
    position   INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT milestones_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT milestones_position_sane   CHECK (position >= 0)
);

CREATE INDEX milestones_goal_idx ON milestones (goal_id, position);

-- A task can back at most one milestone, so the link cannot fan out.
CREATE UNIQUE INDEX milestones_task_key ON milestones (task_id) WHERE task_id IS NOT NULL;

CREATE TRIGGER habits_set_updated_at
    BEFORE UPDATE ON habits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER goals_set_updated_at
    BEFORE UPDATE ON goals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER milestones_set_updated_at
    BEFORE UPDATE ON milestones
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
