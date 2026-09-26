# PostgreSQL Database Architecture & Entity Specifications (Phase P3)

This document provides the authoritative specification of the PostgreSQL 16 schema, referential integrity rules, triggers, indexes, and security roles for the LifeStyle App, strictly adhering to **LifeStyle App — Final Technical & Product Specification v1.0.1 (Section 6, Section 7, and ADRs 005, 006, 008, 009, 010, 011, 013, 023, 029)**.

---

## 1. Schema Conventions & Global Rules

1. **Naming & Identifiers:**
   - Tables are named in `snake_case` plural (e.g., `tasks`, `goals`, `transactions`).
   - Columns are named in `snake_case` (e.g., `user_id`, `created_at`, `occurred_on`).
   - Primary keys are UUIDs (`id uuid PRIMARY KEY DEFAULT gen_random_uuid()`), except for `audit_logs.id` which is `bigint GENERATED ALWAYS AS IDENTITY` (ADR-008).
2. **Owner Isolation & Cross-Tenant Defense (ADR-005):**
   - Every user-owned table carries `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`.
   - Every parent table defines `UNIQUE (id, user_id)`.
   - Child tables reference parent tables via composite foreign keys `(parent_id, user_id) REFERENCES parent(id, user_id)`.
   - The PostgreSQL engine strictly prevents linking rows belonging to different users.
3. **Optimistic Locking & Concurrency (ADR-029):**
   - Mutable aggregate roots carry `version integer NOT NULL DEFAULT 1 CHECK (version >= 1)`.
   - Repositories atomically increment `version = version + 1` and match `WHERE version = expected_version`.
4. **Automated Timestamps:**
   - Every table carries `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL DEFAULT now()`.
   - `BEFORE UPDATE` triggers (`update_updated_at_column()`) automatically maintain `updated_at`.
5. **Money & Precision (ADR-009):**
   - Stored strictly as `numeric(19,4)` with `CHECK (amount > 0)`.
   - Currencies are ISO-4217 3-letter uppercase codes enforced via `CHECK (currency ~ '^[A-Z]{3}$')`.
6. **Soft Delete Semantics:**
   - Soft-deleted tables carry `deleted_at timestamptz NULL`.
   - All normal queries, unique partial indexes, and aggregates filter `WHERE deleted_at IS NULL`.

---

## 2. Complete Entity Catalogue (All 22 MVP Tables)

### Group 1: Identity & Security
1. **`users`**: Root tenant table (`id`, `email citext`, `password_hash`, `display_name`, `timezone`, `locale`, `week_start`, `default_currency`, `status`, `push_show_titles`).
2. **`auth_sessions`**: Active sessions / devices (`user_id`, `device_platform`, `absolute_expires_at`, `revoked_at`, `revoked_reason`).
3. **`refresh_tokens`**: 256-bit opaque tokens stored as SHA-256 hashes (`token_hash bytea(32)`, `rotated_at`, `replaced_by`).
4. **`push_devices`**: FCM/APNS push tokens bound to user sessions (`push_token unique`, `platform`, `disabled_at`).
5. **`audit_logs`**: Append-only security audit events (`actor_type`, `event_type`, `outcome`, `metadata jsonb`).

### Group 2: Planning & Tasks
6. **`goals`**: Long-term objectives (`progress_type IN ('milestones', 'numeric')`, `target_value`, `achieved_at`).
7. **`milestones`**: Discrete progress steps owned by a goal (`goal_id`, `sort_order`, `completed_at`).
8. **`projects`**: Grouping containers for tasks (`goal_id ON DELETE SET NULL`, `status`, `color`).
9. **`recurring_tasks`**: Recurrence templates (`project_id ON DELETE SET NULL`, `priority`, `generated_through`).
10. **`habits`**: Daily/weekly routine commitments (`start_date`, `reminder_time`, `goal_id ON DELETE SET NULL`).
11. **`recurrences`**: 1:1 scheduling value object (`recurring_task_id`, `habit_id`, `freq`, `interval`, `by_weekday`, `by_month_day`).
12. **`tasks`**: Discrete actionable work items (`project_id ON DELETE SET NULL`, `recurring_task_id ON DELETE SET NULL`, `occurrence_date`, `is_focus`, `search_vector`).
13. **`timer_sessions`**: Tracked focus intervals (`task_id ON DELETE CASCADE`, `mode`, `started_at`, `ended_at`).
14. **`habit_checkins`**: Daily streak records (`habit_id ON DELETE CASCADE`, `checkin_date`, `status`).

### Group 3: Notes & Knowledge
15. **`notes`**: Free-form markdown notes (`body`, `tags text[]`, `is_pinned`, `search_vector`).
16. **`note_links`**: Polymorphic junction table (`note_id`, `task_id`, `project_id`, `goal_id`, `habit_id`, `event_id`).

### Group 4: Financial Operating System
17. **`categories`**: Taxonomy classifications (`kind IN ('expense', 'income')`, `name`, `icon`, `color`, `archived_at`).
18. **`subscriptions`**: Recurring commitments (`anchor_date`, `next_billing_date`, `category_kind = 'expense'`).
19. **`transactions`**: Idempotent money ledger (`kind`, `amount`, `occurred_on`, `category_id ON DELETE RESTRICT`, `idempotency_key`).
20. **`budgets`**: Monthly expenditure targets (`category_kind = 'expense'`, `amount_limit`, `period = 'monthly'`).

### Group 5: Time & Reminders
21. **`events`**: Calendar appointments (`start_at`, `end_at`, `all_day`, `timezone`).
22. **`reminders`**: Unified notification scheduling table (`entity_type`, `entity_id`, `remind_at`, `next_attempt_at`).

---

## 3. Foreign Key Cascades & SET NULL Purge Semantics

A critical architectural rule (Section 6.2a) governs nullable foreign keys: **A CHECK constraint on the child table must never require the nulled column to stay non-null or to match another column.**

1. **`tasks.recurring_task_id` (ON DELETE SET NULL):**
   - When a recurring task template is purged, `tasks.recurring_task_id` becomes `NULL`.
   - The one-directional check `CHECK (recurring_task_id IS NULL OR occurrence_date IS NOT NULL)` ensures `tasks.occurrence_date` is preserved as historical context without violating constraints.
2. **`transactions.subscription_id` (ON DELETE SET NULL):**
   - When a subscription is purged, `transactions.subscription_id` becomes `NULL`.
   - The one-directional check `CHECK (subscription_id IS NULL OR billing_date IS NOT NULL)` ensures `transactions.billing_date` is preserved as historical context without violating constraints.
3. **`categories` (ON DELETE RESTRICT):**
   - Categories cannot be deleted while referenced by active or soft-deleted transactions, subscriptions, or budgets.
   - Deletion fails with foreign key violation code `23503`, safeguarding financial audit integrity.
4. **Category Kind Matching:**
   - Composite foreign keys `(category_id, user_id, kind) REFERENCES categories (id, user_id, kind)` prevent cross-kind assignment (e.g. assigning an income category to an expense transaction).
   - Subscriptions and budgets enforce `category_kind = 'expense'` via generated stored columns.
