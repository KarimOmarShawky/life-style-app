# Architecture Documentation — Calendar & Time Blocking

**Phase:** P6 — Calendar & Time Blocking  
**Status:** Implemented & Verified  
**Date:** 2026-09-28  
**Specification Reference:** LifeStyle App Specification v1.0.1 (Sections 1.4.7, 6.8, 14.14–14.15, 18)

---

## 1. Executive Summary

Phase P6 delivers the Calendar and Time Blocking domain of the LifeStyle App. It provides production-ready REST endpoints, domain services, Kysely-based PostgreSQL repositories, and conflict detection engines for:
1. **Calendar Events (`/api/v1/events`)**: Time-blocked appointments and calendar entries with deterministic temporal intervals (`start_at`, `end_at`), all-day flags, timezone awareness, and location details.
2. **Conflict Detection (`/api/v1/events/conflicts`)**: Real-time interval overlap calculation identifying scheduling collisions across user events, supporting self-exclusion for update workflows.
3. **Daily Agenda View (`/api/v1/events/agenda`)**: Timezone-accurate daily calendar projection aggregating all events falling within the user's localized calendar day.
4. **Unified Reminders (`/api/v1/events/{id}/reminders`)**: Notification scheduling bound to calendar events, supporting offset calculations and automatic cancellation upon event deletion.
5. **Lifecycle & Concurrency (`/api/v1/events/{id}`)**: Soft-deletion with 30-day restore window, and optimistic concurrency control via integer `version` tracking.

All implementations strictly respect the MVP boundary: no recurring events, no external calendar synchronization, and single-user personal scope.

---

## 2. Domain Models & Storage

### 2.1 Database Schema

Calendar events and reminders are persisted in PostgreSQL with composite keys guaranteeing tenant isolation at the database constraint level.

```sql
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
  FOREIGN KEY (event_id, user_id) REFERENCES events (id, user_id) ON DELETE CASCADE,
  CHECK (num_nonnulls(task_id, habit_id, event_id, subscription_id) = 1)
);
```

### 2.2 Relational Invariants

1. **Composite Ownership Foreign Key**:
   `FOREIGN KEY (event_id, user_id) REFERENCES events (id, user_id) ON DELETE CASCADE` physically guarantees that reminders cannot be created or linked across different user boundaries.
2. **Temporal Validity Check**:
   `CHECK (end_at >= start_at)` prevents backwards or negative-duration time blocks at the database engine level.
3. **Polymorphic Exclusivity**:
   `CHECK (num_nonnulls(task_id, habit_id, event_id, subscription_id) = 1)` guarantees that a reminder belongs to exactly one parent entity.
4. **Trigger-Maintained Timestamps**:
   `trg_events_updated_at` automatically updates `updated_at = NOW()` on any modification.

---

## 3. Conflict Detection Engine

Conflict detection identifies overlapping calendar entries for scheduling and time blocking.

### 3.1 Interval Overlap Algorithm

Two intervals $[A_{\text{start}}, A_{\text{end}}]$ and $[B_{\text{start}}, B_{\text{end}}]$ overlap if and only if:

$$A_{\text{start}} < B_{\text{end}} \quad \land \quad A_{\text{end}} > B_{\text{start}}$$

This mathematical definition guarantees:
- **Adjacent events do not conflict**: If Event A ends at 10:00 and Event B starts at 10:00, $A_{\text{end}} \ngtr B_{\text{start}}$, so they do not collide.
- **Partial overlaps**: Detected regardless of which event starts first.
- **Enclosures**: An event completely contained within another is detected.

### 3.2 SQL Implementation

```sql
SELECT * FROM events
WHERE user_id = $1
  AND deleted_at IS NULL
  AND start_at < $3
  AND end_at > $2
  AND ($4::uuid IS NULL OR id != $4)
ORDER BY start_at ASC;
```

---

## 4. Daily Agenda & Timezone Calculations

### 4.1 Timezone-Aware Day Bounds (`getDayBoundsUtc`)

Given a calendar date (e.g. `2026-10-01`) and a user's IANA timezone (e.g. `Africa/Cairo` or `America/New_York`):
1. The start of the local day (00:00:00.000) is translated to its exact UTC instant.
2. The end of the local day (23:59:59.999) is translated to its exact UTC instant.
3. All events overlapping with that UTC interval are retrieved:

```sql
SELECT * FROM events
WHERE user_id = $1
  AND deleted_at IS NULL
  AND start_at < $dayEndUtc
  AND end_at >= $dayStartUtc
ORDER BY start_at ASC;
```

---

## 5. Reminders Lifecycle & Automatic Cancellation

1. **Embedded Creation**: Events can be created with an array of reminders in the initial `POST /api/v1/events` payload.
2. **Offset Resolution**: If `offsetMinutes` is provided, `remindAt = startAt - offsetMinutes * 60000`. If `remindAt` is provided, `offsetMinutes` is derived.
3. **Pre-Start Constraint**: Reminders must be scheduled before or at the event start time (`remindAt <= startAt`).
4. **Soft-Delete Cancellation**: When an event is soft-deleted, all pending reminders are transactionally updated to `status = 'cancelled'`, preventing ghost notifications.

---

## 6. Concurrency & Soft-Deletion

1. **Optimistic Locking**:
   - `events` carries `version INTEGER NOT NULL DEFAULT 1`.
   - Modifying an event requires matching `version`. Successful updates increment `version = version + 1`.
   - On version mismatch, the service throws `AppError.conflict('VERSION_CONFLICT', 'Conflict: Event was modified concurrently')`.
2. **30-Day Restoration**:
   - Soft-deleted events retain `deleted_at = NOW()`.
   - Restoration via `POST /api/v1/events/{id}/restore` checks `deleted_at >= NOW() - INTERVAL '30 days'`.
   - If older than 30 days, returns HTTP `410 Gone` (`RESTORE_WINDOW_EXPIRED`).

---

## 7. Testing & Verification Summary

- **Unit Suite (`tests/unit/calendar-conflict.test.ts`)**: 8 tests verifying interval overlap conditions and timezone-aware day bounds.
- **Integration Suite (`tests/integration/calendar-flow.test.ts`)**: 8 end-to-end HTTP integration tests against live PostgreSQL verifying CRUD, conflict detection, reminder cancellation, 30-day restore, optimistic concurrency, and multi-tenant isolation.
