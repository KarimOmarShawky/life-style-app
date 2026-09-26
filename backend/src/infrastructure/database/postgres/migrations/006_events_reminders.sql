-- Calendar events and the unified reminder table (ERD: Event, Reminder).
--
-- Both carry polymorphic references, drawn as dashed lines in the ERD. The
-- database cannot enforce a foreign key whose target table varies per row, so
-- validity is checked in the service layer before the write (NFR-4). What the
-- database CAN still enforce is captured below: the discriminator is restricted
-- to a known set, and the pair is all-or-nothing.

CREATE TABLE events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title       TEXT        NOT NULL,
    description TEXT,
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ NOT NULL,
    all_day     BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Polymorphic, optional: an event may stand alone or point at a task or habit.
    linked_type TEXT,
    linked_id   UUID,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT events_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT events_end_after_start CHECK (end_time >= start_time),
    CONSTRAINT events_linked_type_valid CHECK (linked_type IS NULL OR linked_type IN ('task', 'habit')),
    -- Half a polymorphic reference is always a bug: a type with no id, or an id
    -- with no type, is unresolvable. The database rejects both.
    CONSTRAINT events_link_is_complete CHECK (
        (linked_type IS NULL AND linked_id IS NULL)
        OR (linked_type IS NOT NULL AND linked_id IS NOT NULL)
    )
);

-- The calendar's day, week and month views are all range scans per user.
CREATE INDEX events_user_start_idx ON events (user_id, start_time);
CREATE INDEX events_linked_idx     ON events (linked_type, linked_id)
    WHERE linked_type IS NOT NULL;


-- One shared table for every kind of reminder (FR-23).
CREATE TABLE reminders (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    entity_type        TEXT        NOT NULL,
    entity_id          UUID        NOT NULL,

    remind_at          TIMESTAMPTZ NOT NULL,
    offset_description TEXT,
    status             TEXT        NOT NULL DEFAULT 'pending',
    sent_at            TIMESTAMPTZ,
    attempts           INTEGER     NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT reminders_entity_type_valid CHECK (
        entity_type IN ('task', 'habit', 'subscription', 'event')
    ),
    CONSTRAINT reminders_status_valid CHECK (status IN ('pending', 'sent', 'dismissed', 'failed')),
    CONSTRAINT reminders_sent_at_matches_status CHECK (
        (status = 'sent' AND sent_at IS NOT NULL) OR (status <> 'sent')
    ),
    CONSTRAINT reminders_attempts_sane CHECK (attempts >= 0)
);

-- The delivery worker's only query: pending reminders that are now due, in time
-- order, across all users. Partial so the index holds just the work queue rather
-- than the full history of everything ever sent.
CREATE INDEX reminders_due_idx ON reminders (remind_at)
    WHERE status = 'pending';

CREATE INDEX reminders_entity_idx ON reminders (entity_type, entity_id);
CREATE INDEX reminders_user_idx   ON reminders (user_id, remind_at DESC);

-- The same entity must not accumulate duplicate pending reminders for the same
-- instant, which would otherwise send the user two identical notifications.
CREATE UNIQUE INDEX reminders_no_duplicate_pending
    ON reminders (entity_type, entity_id, remind_at)
    WHERE status = 'pending';

CREATE TRIGGER events_set_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER reminders_set_updated_at
    BEFORE UPDATE ON reminders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
