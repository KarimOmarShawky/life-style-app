# Security Review — Phase P8: Notes & Linking

**Phase:** P8 — Notes & Linking  
**Date:** 2026-09-28  
**Scope:** Notes domain, polymorphic note links, full-text search, tag normalization, and soft-delete restoration lifecycle.

---

## 1. Scope & Security Objectives

The Phase P8 implementation introduces rich, free-form text storage and polymorphic relationships connecting notes to five core entities (tasks, projects, goals, habits, and events). The primary security objectives include:
1. **Preventing Cross-Tenant Data Access and Cross-Tenant Linking (ADR-038)**.
2. **Safe Handling of Arbitrary Text and Injection Payloads (AC-NOTE-02)**.
3. **Preventing Resource Exhaustion (DoS) through Payloads, Tags, and Quota Limits (ADR-037)**.
4. **Enforcing Concurrency Integrity (OCC) under Simultaneous Edits**.
5. **Mitigating Restoration Abuse for Expired Tombstones**.

---

## 2. STRIDE Threat Modeling & Mitigations

### 2.1 Spoofing
- **Threat:** An unauthenticated or forged token accessing or modifying user notes.
- **Mitigation:** All `/api/v1/notes` routes enforce `authenticate` middleware validating Bearer JWTs against active sessions in PostgreSQL/Redis. Revoked sessions or expired tokens are immediately rejected with `401 UNAUTHENTICATED`.

### 2.2 Tampering
- **Threat:** Concurrent writers overwriting each other's edits, or an attacker tampering with another user's note links.
- **Mitigation:**
  - Optimistic concurrency control via the `version` column. Mismatched versions trigger `409 Conflict` (`VERSION_CONFLICT`).
  - Database composite primary keys `(id, user_id)` and foreign keys `(note_id, user_id)` guarantee note links cannot be attached to another user's note.
  - Link replacement in `PATCH /api/v1/notes/:id` executes within an atomic transaction.

### 2.3 Repudiation
- **Threat:** Changes occurring without an audit trail or verifiable timestamp.
- **Mitigation:** Every note and link records `created_at`, `updated_at`, and integer `version`. Database triggers ensure `updated_at` cannot be forged or bypassed.

### 2.4 Information Disclosure
- **Threat:** An attacker probing for the existence of foreign notes or linked entities; leaking sensitive content in list views.
- **Mitigation:**
  - Strict compliance with **ADR-038**: Unowned or non-existent notes and linked entities always return HTTP `404 Not Found`, eliminating ID harvesting attacks.
  - Payloads in `GET /api/v1/notes` omit the 100 KB `body` and only return a 200-character `excerpt`, reducing data leakage on summary screens and mitigating payload sizes over mobile connections.
  - Full-text search strictly scopes vectors with `WHERE user_id = $userId AND deleted_at IS NULL`. Queries matching words present in other users' data will never reveal their content.

### 2.5 Denial of Service (DoS)
- **Threat:** Storage exhaustion attacks using massive text bodies, infinite tags, or excessive note creation.
- **Mitigation:**
  - Global body limit enforced at `100 KB` by Express middleware.
  - Schema and DB validation ceiling on `body` at `100,000` characters.
  - Maximum `20` tags per note, with each tag constrained between `1` and `40` characters.
  - Maximum `20` links per note.
  - Hard per-user active note quota capped at `5,000` notes (ADR-037). Exceeding quota returns `409 Conflict` (`QUOTA_EXCEEDED`).
  - Rate limiting enforced at `300 req / 60 s` per authenticated user and `120 req / 60 s` per IP.

### 2.6 Elevation of Privilege
- **Threat:** Exploiting polymorphic endpoints to bypass entity ownership boundaries.
- **Mitigation:**
  - All polymorphic links enforce composite foreign keys to the target tables: `FOREIGN KEY (target_id, user_id) REFERENCES target_table (id, user_id)`.
  - Attempting to link a task/project/goal/habit/event belonging to User B into User A's note causes a PostgreSQL foreign key violation (`23503`), which the service translates to `404 Not Found`.

---

## 3. Specific Security Mechanisms & Analysis

### 3.1 Opaque Text Storage & XSS Immunity (AC-NOTE-02)
- **Design:** The LifeStyle App API treats note titles and bodies as opaque plain text.
- **Implementation:**
  - The API does not parse, sanitize, evaluate, or convert Markdown/HTML on the server.
  - Injected script tags (e.g., `<script>alert('xss')</script>`) are stored verbatim and served as pure JSON string values with `Content-Type: application/json; charset=utf-8`.
  - The native Flutter client renders notes into native mobile widgets or text views without web engine execution, neutralizing Stored XSS vectors.

### 3.2 Polymorphic Linking Multi-Tenant Guard (AC-NOTE-03)
- The table `note_links` uses database constraints:
  ```sql
  FOREIGN KEY (note_id, user_id) REFERENCES notes (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (task_id, user_id) REFERENCES tasks (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, user_id) REFERENCES projects (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (habit_id, user_id) REFERENCES habits (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (event_id, user_id) REFERENCES events (id, user_id) ON DELETE CASCADE,
  CHECK (num_nonnulls(task_id, project_id, goal_id, habit_id, event_id) = 1)
  ```
- Because every foreign key includes `user_id`, PostgreSQL prevents cross-tenant associations at the lowest storage layer.

### 3.3 Zombie Note Restoration Mitigation (AC-NOTE-04)
- Soft-deleted notes remain recoverable for exactly 30 days.
- When `POST /api/v1/notes/:id/restore` is called:
  - The service verifies `deleted_at >= NOW() - INTERVAL '30 days'`.
  - Expired records cannot be revived and return HTTP `410 Gone`.
  - Attempting to restore active notes returns `409 Conflict` (`NOT_DELETED`).

---

## 4. Security Verification Results

| Vulnerability Vector | Severity | Status | Mitigation Mechanism |
|---|---|---|---|
| **Cross-Tenant Note Access** | Critical | **MITIGATED** | `user_id` query scoping & composite PK `(id, user_id)` (returns 404) |
| **Cross-Tenant Entity Linking** | High | **MITIGATED** | Composite FKs `(target_id, user_id)` on `note_links` |
| **Stored XSS Injection** | Medium | **MITIGATED** | Stored as opaque text, strict JSON mime typing |
| **Concurrent Edit Overwrites** | Medium | **MITIGATED** | Optimistic concurrency control via `version` (returns 409) |
| **Payload Flooding / Abuse** | Medium | **MITIGATED** | 100 KB body limit, 100k char limit, 20 tags limit, 5000 quota |
| **Zombie Note Resuscitation** | Low | **MITIGATED** | 30-day restore cutoff check returning 410 Gone |
| **SQL Injection via Search / Tags**| High | **MITIGATED** | Parameterized queries with Kysely and `plainto_tsquery` |
