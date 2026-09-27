# Architecture Documentation — Notes & Linking

**Phase:** P8 — Notes & Linking  
**Status:** Implemented & Verified  
**Date:** 2026-09-28  
**Specification Reference:** LifeStyle App Specification v1.0.1 (Sections 1.4.11, 6.6, 14.10, 18)

---

## 1. Executive Summary

Phase P8 delivers the Notes and Polymorphic Linking domain of the LifeStyle App. It provides production-ready REST endpoints, domain services, Kysely-based PostgreSQL repositories, and full-text search capabilities for:
1. **Notes Management (`/api/v1/notes`)**:
   - Fast, expressive note creation and editing with optional title (up to 200 characters), opaque text body (up to 100,000 characters), normalized tags (up to 20 tags, each 1–40 characters), and pinning flags.
   - Non-empty invariant enforced at both schema and database levels (`CHECK (title IS NOT NULL OR char_length(body) > 0)`).
   - Opaque text storage: content (including HTML and script payloads) is stored and returned verbatim without server-side execution or manipulation.
2. **Full-Text Search & Filtering (`GET /api/v1/notes`)**:
   - Full-text search querying a generated `search_vector` (`tsvector`) and trigram index over titles, bodies, and tags.
   - Tag filtering via array inclusion (`tag = ANY(tags)`).
   - Ordering strictly prioritizing pinned items: `ORDER BY is_pinned DESC, updated_at DESC`.
   - List payload optimization: returns `NoteListItem` containing a 200-character `excerpt`, omitting the heavy 100 KB body.
3. **Tags Aggregation (`GET /api/v1/notes/tags`)**:
   - Aggregates distinct tags and active counts across the caller's non-deleted notes using PostgreSQL `unnest(tags)`.
4. **Polymorphic Entity Linking (`/api/v1/notes/:id/links`)**:
   - Connects notes to any single domain entity: **Tasks**, **Projects**, **Goals**, **Habits**, or **Events**.
   - Enforces mutual exclusivity via PostgreSQL `CHECK (num_nonnulls(task_id, project_id, goal_id, habit_id, event_id) = 1)`.
   - Multi-tenant foreign key security: composite FKs `FOREIGN KEY (target_id, user_id) REFERENCES target_table (id, user_id)` prevent linking cross-tenant or unowned resources.
   - Atomic replacement: updating links via `PATCH /api/v1/notes/:id` replaces the entire set in a single database transaction.
5. **Lifecycle & Concurrency**:
   - Soft-deletion with a 30-day restore window (`POST /api/v1/notes/:id/restore`).
   - Rejects expired restorations with `410 Gone` and active notes with `409 NOT_DELETED`.
   - Polymorphic note links are strictly preserved upon soft-deletion and restoration.
   - Optimistic concurrency control via integer `version` tracking (`409 VERSION_CONFLICT`).

---

## 2. Domain Models & Storage

### 2.1 Database Schema

Notes and polymorphic links are persisted in PostgreSQL 16 with composite primary and foreign keys enforcing tenant isolation at the database constraint level.

```sql
-- Notes Table (§6.6)
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

-- Indexes for Notes
CREATE INDEX idx_notes_user_pinned 
  ON notes (user_id, is_pinned DESC, updated_at DESC) 
  WHERE deleted_at IS NULL;

CREATE INDEX idx_notes_tags 
  ON notes USING gin (tags);

CREATE INDEX idx_notes_search 
  ON notes USING gin (search_vector);

CREATE INDEX idx_notes_trgm 
  ON notes USING gin (title gin_trgm_ops);

-- Polymorphic Note Links Table (§6.6)
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

-- Unique partial indexes per target entity type
CREATE UNIQUE INDEX idx_note_links_task ON note_links (note_id, task_id) WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX idx_note_links_project ON note_links (note_id, project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX idx_note_links_goal ON note_links (note_id, goal_id) WHERE goal_id IS NOT NULL;
CREATE UNIQUE INDEX idx_note_links_habit ON note_links (note_id, habit_id) WHERE habit_id IS NOT NULL;
CREATE UNIQUE INDEX idx_note_links_event ON note_links (note_id, event_id) WHERE event_id IS NOT NULL;
```

---

## 3. Full-Text Search & Tag Management

### 3.1 GIN Full-Text Search Vector
Per Section 6.6 and ADR-034:
- The `search_vector` column is a `GENERATED ALWAYS AS (...) STORED` tsvector over `coalesce(title, '') || ' ' || body || ' ' || immutable_array_to_string(tags, ' ')`.
- Queries utilize `plainto_tsquery('simple', $q)` for language-agnostic token matching, paired with a trigram `ILIKE` condition on `title` to provide prefix and fuzzy matching.
- An immutable helper function `immutable_array_to_string(text[], text)` allows array elements to participate deterministically in generated column storage.

### 3.2 Tag Normalization and Invariants (ADR-034)
- Tags are stored as a PostgreSQL array `TEXT[]` directly on the `notes` row.
- Input validation sanitizes each tag: `.trim().toLowerCase()`.
- Duplicates are stripped before persistence (`Set`).
- Maximum 20 tags per note; each tag is bounded between 1 and 40 characters.
- Aggregation endpoint `GET /api/v1/notes/tags` executes:
  ```sql
  SELECT unnest(tags) AS tag, count(*)::int AS count
  FROM notes
  WHERE user_id = $1 AND deleted_at IS NULL
  GROUP BY tag
  ORDER BY count DESC, tag ASC
  ```

---

## 4. Polymorphic Linking Engine

### 4.1 Strict Single-Reference Constraint
A single note link represents a relationship to exactly one target entity. The table enforces this via PostgreSQL's `num_nonnulls()` function:
```sql
CHECK (num_nonnulls(task_id, project_id, goal_id, habit_id, event_id) = 1)
```

### 4.2 Multi-Tenant Foreign Key Safety
Every foreign key in `note_links` references a composite key `(entity_id, user_id)`.
- If User A attempts to link User B's task, project, goal, habit, or event, the composite foreign key constraint fails immediately (`23503`).
- The application service intercepts this violation and raises `AppError.notFound('Referenced entity does not exist')`, completely preserving cross-tenant isolation (ADR-038).

### 4.3 Atomic Link Replacement
Section 14.10 states: *"On PATCH, links replaces the whole set."*
When `links` is supplied in `PATCH /api/v1/notes/:id`:
- The service initiates a database transaction.
- Existing links for that `(note_id, user_id)` are removed: `DELETE FROM note_links WHERE note_id = $1 AND user_id = $2`.
- New link records are validated and bulk inserted.
- If any referenced entity is invalid or belongs to another user, the transaction rolls back cleanly.

---

## 5. Lifecycle, Soft-Deletion & Restoration

### 5.1 Soft Deletion
- Executing `DELETE /api/v1/notes/:id` sets `deleted_at = now()`, increments `version = version + 1`, and updates `updated_at`.
- Active queries (`GET /api/v1/notes`, `GET /api/v1/notes/:id`) filter out soft-deleted notes (`WHERE deleted_at IS NULL`).
- Associated `note_links` rows are retained in the database during soft deletion so that restoring the note immediately restores its relationships.

### 5.2 30-Day Restoration Window
- Endpoint: `POST /api/v1/notes/:id/restore`.
- If the note is not deleted: returns HTTP `409 Conflict` (`NOT_DELETED`).
- If `deleted_at < NOW() - INTERVAL '30 days'`: returns HTTP `410 Gone`.
- If within the 30-day window: resets `deleted_at = null`, increments `version`, updates `updated_at`, and returns the restored note with all its links.

---

## 6. REST API Endpoints Specification

| Method | Path | Auth | Description | Status Codes |
|---|---|---|---|---|
| `GET` | `/api/v1/notes` | Bearer | List notes with `isPinned` order, `excerpt`, tag/entity filters, search `q` | `200` |
| `POST` | `/api/v1/notes` | Bearer | Create note with optional title, body, tags, isPinned, and initial links | `201`, `400`, `409` |
| `GET` | `/api/v1/notes/tags` | Bearer | Returns caller's tag counts across active notes | `200` |
| `GET` | `/api/v1/notes/:id` | Bearer | Retrieve note by ID including full body and links | `200`, `404` |
| `PATCH` | `/api/v1/notes/:id` | Bearer | Update note fields, optimistic lock via `version`, replace links | `200`, `400`, `404`, `409` |
| `DELETE` | `/api/v1/notes/:id` | Bearer | Soft delete note | `204`, `404` |
| `POST` | `/api/v1/notes/:id/restore` | Bearer | Restore soft-deleted note within 30-day window | `200`, `404`, `409`, `410` |
| `POST` | `/api/v1/notes/:id/links` | Bearer | Add a polymorphic link to a task, project, goal, habit, or event | `201`, `400`, `404`, `409` |
| `GET` | `/api/v1/notes/:id/links` | Bearer | List all polymorphic links for a note | `200`, `404` |
| `DELETE` | `/api/v1/notes/:id/links/:linkId` | Bearer | Remove a polymorphic link from a note | `204`, `404` |

---

## 7. Concurrency & Security Architecture

### 7.1 Optimistic Concurrency Control (OCC)
- Updating a note with a stale `version` fails the query predicate: `WHERE id = $id AND user_id = $userId AND version = $expectedVersion`.
- The repository returns `null`, prompting the service to check if the note exists.
- If it exists, the service throws `AppError.conflict('VERSION_CONFLICT', 'Conflict: Note was modified concurrently')` (`409 Conflict`).

### 7.2 Multi-Tenant Isolation (ADR-038)
- Every query enforces `WHERE user_id = $userId`.
- Foreign keys in `note_links` enforce `(note_id, user_id)` and `(target_id, user_id)`.
- If an entity belongs to another user, the request returns `404 Not Found` rather than `403 Forbidden`, preventing resource existence probing.
