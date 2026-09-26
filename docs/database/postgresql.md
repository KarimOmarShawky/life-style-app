# PostgreSQL Technical Specification

> **Specification Reference:** Section 6.1, 6.2 & 7

## 1. Engine Conventions & Data Types

* **Engine:** PostgreSQL 16+
* **Primary Keys:** `UUID` generated via `gen_random_uuid()` or `pgcrypto`.
* **Timestamps:**
  * Instants (`created_at`, `updated_at`, `deleted_at`, `remind_at`) are stored as `timestamptz` (always UTC).
  * Civil dates (`planned_date`, `due_date`, `checkin_date`) are stored as `date` (carrying no timezone).
  * Wall-clock times (`due_time`, `reminder_time`) are stored as `time`.
* **Monetary Values:** `numeric(19,4)` — exact fixed-point representation with four decimal places.
* **Audit Columns:** Every business entity includes:
  * `created_at timestamptz NOT NULL DEFAULT now()`
  * `updated_at timestamptz NOT NULL DEFAULT now()`
  * Aggregate roots carry `deleted_at timestamptz` for soft deletion.
* **Optimistic Concurrency:** Aggregate roots carry `version integer NOT NULL DEFAULT 1` incremented on every update.

---

## 2. Connection Pooling & Resource Limits

* Connection pool implemented via `pg.Pool` (`src/infrastructure/database/postgres/pool.ts`).
* Configured with `max: 10` connections per process by default (`DATABASE_POOL_MAX`).
* Connection timeout: 5000 ms; idle client timeout: 30000 ms.
* Statement timeouts and keep-alive tuned for production proxy environments.
