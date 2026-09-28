# Architecture Documentation — Tasks, Projects, Recurring Tasks & Timer Sessions

**Phase:** P4 — Tasks & Projects  
**Status:** Implemented & Verified  
**Date:** 2026-09-27  
**Specification Reference:** LifeStyle App Specification v1.0.1 (Section 1.4.3–1.4.5, 1.4.12, 6.4, 7.2–7.3, 14.4–14.7, 18)

---

## 1. Executive Summary

Phase P4 delivers the core task execution engine of LifeStyle App. It provides the domain models, repositories, business services, HTTP REST controllers, and validation contracts for:
1. **Tasks (`/api/v1/tasks`)**: Granular action items with deterministic completion lifecycles, atomic daily focus management, timezone-aware overdue computation, soft-deletion with 30-day restore window, and aggregate tracked time.
2. **Projects (`/api/v1/projects`)**: Structural containers organizing tasks towards goals, supporting real-time open/done task counts, detachment vs. cascading deletion modes, and restoration semantics.
3. **Recurring Tasks & Recurrence Engine (`/api/v1/recurring-tasks`)**: Operational template engine generating standard task instances across daily, weekly, monthly, and yearly cadences with idempotent horizon generation and selective template-update propagation.
4. **Timer Sessions (`/api/v1/timer-sessions`)**: Work execution tracking with stopwatch and countdown modes, single active timer constraint per user, server-authoritative timestamp-derived duration, auto-close for stale timers (> 12 hours), and tamper prevention.

All implementations strictly adhere to the MVP boundary, PostgreSQL 16 single-source-of-truth rule, composite-key cross-tenant isolation, and layered clean architecture.

---

## 2. Tasks Architecture

### 2.1 Domain Model & Storage

Tasks are persisted in the `tasks` table with a composite ownership guarantee `(id, user_id)`.

```sql
CREATE TABLE tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL CHECK (char_length(btrim(title)) >= 1),
  description VARCHAR(10000),
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
  search_vector TSVECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (id, user_id),
  UNIQUE (id, user_id),
  FOREIGN KEY (project_id, user_id) REFERENCES projects (id, user_id) ON DELETE SET NULL,
  FOREIGN KEY (recurring_task_id, user_id) REFERENCES recurring_tasks (id, user_id) ON DELETE SET NULL (recurring_task_id),
  CHECK (due_time IS NULL OR due_date IS NOT NULL),
  CHECK (NOT is_focus OR planned_date IS NOT NULL),
  CHECK (recurring_task_id IS NULL OR occurrence_date IS NOT NULL)
);
```

### 2.2 Task Completion Lifecycle (AC-TASK-01)

- When a task transitions from any non-done status to `'done'`, the system automatically sets `completed_at = clock.now()`.
- When a task transitions from `'done'` to any other status (`'todo'`, `'in_progress'`, `'cancelled'`), the system automatically clears `completed_at = null`.
- Marking a task `'done'` directly on creation automatically sets `completed_at = clock.now()`.
- `completed_at` is server-derived and never directly settable by the client.

### 2.3 Atomic Focus Task Management (AC-TASK-02)

The application guarantees that a user can have at most one focused task per calendar day:
- **Database Constraint:** `CREATE UNIQUE INDEX idx_tasks_one_focus_per_day ON tasks (user_id, planned_date) WHERE is_focus AND deleted_at IS NULL;`
- **Application Logic:** When a task is created or updated with `isFocus: true` for a `plannedDate`:
  1. The repository atomically updates any existing focused tasks for that user on that planned date:
     ```sql
     UPDATE tasks
     SET is_focus = false, updated_at = now()
     WHERE user_id = $userId
       AND planned_date = $plannedDate
       AND is_focus = true
       AND id != $currentTaskId
       AND deleted_at IS NULL;
     ```
  2. The target task is set to `is_focus = true`.
  3. This ensures zero constraint violations while keeping focus task selection frictionless for mobile clients.

### 2.4 Timezone-Aware Overdue Filtering (AC-TASK-03)

Because dates (`due_date`) are civil dates (`YYYY-MM-DD`) and user timezones vary, computing "overdue" cannot use the server's local clock.
- The user's timezone is retrieved from `req.user.timezone` (e.g. `'Africa/Cairo'`).
- The current user civil date is computed via `Intl.DateTimeFormat('en-CA', { timeZone: userTimezone })`.
- The overdue query filter evaluates:
  ```sql
  WHERE user_id = $userId
    AND due_date < $userToday
    AND status NOT IN ('done', 'cancelled')
    AND deleted_at IS NULL
  ```
- Tasks that are completed or cancelled are excluded from overdue lists regardless of due date.

### 2.5 Soft-Delete & Restore Lifecycle (AC-TASK-04)

- **Soft Delete:** Calling `DELETE /api/v1/tasks/:id` sets `deleted_at = clock.now()`.
- **Reminder Cancellation:** Upon soft delete, all pending reminders for this task are immediately cancelled:
  ```sql
  UPDATE reminders
  SET status = 'cancelled', updated_at = now()
  WHERE user_id = $userId AND task_id = $taskId AND status = 'pending';
  ```
- **Restore:** Calling `POST /api/v1/tasks/:id/restore` checks that `deleted_at >= now() - INTERVAL '30 days'`. If valid, it clears `deleted_at = null` and increments `version`. If the 30-day window has expired or the task was not deleted, it returns 404.

### 2.6 Strict Allow-Listed Sorting (AC-TASK-05)

The query parameter `sort` on `GET /api/v1/tasks` is strictly validated by Zod:
- Allowed fields: `dueDate`, `priority`, `createdAt`, `updatedAt`.
- Any unapproved field (e.g. `sort=title`, `sort=sql_injection`) is rejected with HTTP 400 `VALIDATION_ERROR`, listing the permitted fields.

---

## 3. Projects Architecture

### 3.1 Domain Model & Lifecycle

Projects are stored in `projects` with composite key `(id, user_id)`.

```sql
CREATE TABLE projects (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (char_length(btrim(name)) >= 1),
  description VARCHAR(5000),
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
  FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id) ON DELETE SET NULL
);
```

### 3.2 Real-Time Open/Done Task Counts (FR-PROJ-03)

Every project returned in single (`GET /api/v1/projects/:id`) or list (`GET /api/v1/projects`) queries includes real-time task counts:
```sql
SELECT
  project_id,
  COUNT(CASE WHEN status IN ('todo', 'in_progress') THEN 1 END) AS open_count,
  COUNT(CASE WHEN status = 'done' THEN 1 END) AS done_count
FROM tasks
WHERE user_id = $userId
  AND project_id IN (...)
  AND deleted_at IS NULL
GROUP BY project_id;
```
This avoids expensive N+1 queries while ensuring mobile navigation shows live completion progress.

### 3.3 Detachment vs. Cascade Deletion (AC-PROJ-01)

When a project is deleted (`DELETE /api/v1/projects/:id`):
- **Default (`cascade=false`):** All active tasks belonging to the project are preserved and detached:
  ```sql
  UPDATE tasks SET project_id = NULL, updated_at = now()
  WHERE project_id = $id AND user_id = $userId AND deleted_at IS NULL;
  ```
- **Cascade (`cascade=true`):** All active tasks belonging to the project are soft-deleted:
  ```sql
  UPDATE tasks SET deleted_at = now(), updated_at = now()
  WHERE project_id = $id AND user_id = $userId AND deleted_at IS NULL;
  ```
- In both cases, the project itself is soft-deleted (`deleted_at = now()`).
- Restoring a project (`POST /api/v1/projects/:id/restore`) restores the project entity within 30 days. Detached tasks are **not** reattached (per Section 14.5).

---

## 4. Recurring Tasks & Recurrence Engine

### 4.1 Recurrence Engine Architecture

The recurrence engine (`src/features/recurring-tasks/recurrence-engine.ts`) is a pure deterministic date-math module. It calculates occurrences based on:
- `freq`: `'daily' | 'weekly' | 'monthly' | 'yearly'`
- `interval`: positive integer (e.g. every 2 weeks)
- `byWeekday`: array of ISO weekdays `1..7` (1=Monday, 7=Sunday)
- `byMonthDay`: `1..31` or `-1` (where `-1` denotes the last day of the month, handling leap years and 28/30/31 days)
- `byMonth`: `1..12` for yearly recurrence
- `startDate`: starting boundary
- `endDate`: optional ending boundary
- `occurrenceLimit`: optional count ceiling

### 4.2 Idempotent Horizon Generation (AC-REC-01, FR-REC-04)

- Creating a recurring task template immediately calculates occurrences within a 7-day forward horizon `[userToday, userToday + 7 days]`.
- All instances are generated and inserted into `tasks` within the **same database transaction** as the template creation.
- Tasks are inserted with `is_customized = false` and `occurrence_date = date`.
- Database-level partial unique index prevents duplicates:
  ```sql
  CREATE UNIQUE INDEX idx_tasks_recurring_occurrence 
  ON tasks (recurring_task_id, occurrence_date) 
  WHERE recurring_task_id IS NOT NULL;
  ```
  Insertions execute with `ON CONFLICT (recurring_task_id, occurrence_date) DO NOTHING`, ensuring complete idempotency under concurrent execution.

### 4.3 Template Update Propagation (AC-REC-02, FR-REC-05)

When a recurring template is updated (`PATCH /api/v1/recurring-tasks/:id`):
1. The template fields (`title`, `description`, `priority`, `estimateMinutes`, `dueTime`, `projectId`) are updated.
2. The changes propagate **only** to future, open, non-customized instances:
   ```sql
   UPDATE tasks
   SET title = $title, description = $description, priority = $priority,
       estimate_minutes = $estimate, due_time = $dueTime, project_id = $projectId,
       updated_at = now()
   WHERE recurring_task_id = $id
     AND user_id = $userId
     AND is_customized = false
     AND status IN ('todo', 'in_progress')
     AND occurrence_date > $userToday
     AND deleted_at IS NULL;
   ```
3. Instances that are today, in the past, completed, or previously edited (`is_customized = true`) remain completely untouched.
4. Soft-deleting the template (`DELETE /api/v1/recurring-tasks/:id`) preserves all already-generated task instances.

---

## 5. Timer Sessions Architecture

### 5.1 Domain Model & Constraints

```sql
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
  FOREIGN KEY (task_id, user_id) REFERENCES tasks (id, user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_timer_sessions_active ON timer_sessions (user_id) WHERE ended_at IS NULL;
```

### 5.2 Single Active Timer Concurrency (AC-TMR-01)

- A user may only run **one active timer** across the entire application at any given time.
- Enforcement is multi-layered:
  1. **Application Layer:** `findActiveSession(userId)` checks for an existing session where `ended_at IS NULL`. If one exists, the request is rejected with HTTP 409 `TIMER_ALREADY_RUNNING`.
  2. **Database Layer:** The partial unique index `uq_timer_sessions_active ON timer_sessions (user_id) WHERE ended_at IS NULL` physically prevents race conditions.

### 5.3 Server-Authoritative Duration (AC-TMR-02)

- Duration is strictly derived from timestamps:
  ```typescript
  durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
  ```
- Client-supplied elapsed seconds, durations, or completion timestamps are explicitly rejected by Zod schema validation (`.strict()`).

### 5.4 Automatic Stale Timer Closure (FR-TMR-05)

- Timers running for longer than 12 hours (43,200 seconds) are automatically closed:
  ```sql
  UPDATE timer_sessions
  SET ended_at = started_at + INTERVAL '12 hours',
      end_reason = 'auto_closed',
      updated_at = now()
  WHERE user_id = $userId
    AND ended_at IS NULL
    AND started_at <= $twelveHoursAgo;
  ```
- This auto-close check runs transparently whenever an active timer is queried or a new timer is started.

### 5.5 Aggregate Tracked Time (FR-TMR-06)

When querying task details (`GET /api/v1/tasks/:id`):
- The system computes the aggregate tracked seconds across all completed timer sessions:
  `SUM(EXTRACT(EPOCH FROM (ended_at - started_at)))`.
- If an active timer is currently running on that task, its elapsed time `(now - started_at)` is dynamically added.
- The total is returned in the `trackedSeconds` field of `TaskDto`.
