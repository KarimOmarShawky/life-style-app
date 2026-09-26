# Security Review — Phase P4: Tasks, Projects, Recurring Tasks & Timer Sessions

**Audit Date:** 2026-09-27  
**Auditor:** Lead Software Architect & Security Engineer  
**Scope:** `src/features/tasks/`, `src/features/projects/`, `src/features/recurring-tasks/`, `src/features/timer-sessions/`  
**Classification:** Internal Technical Audit  
**Status:** PASS — Zero High / Medium Vulnerabilities Identified

---

## 1. Security Architecture & Threat Model Overview

Phase P4 introduces rich domain interactions involving user-owned tasks, hierarchical project containers, scheduled recurrence templates, and real-time execution timers. The primary threat vectors analyzed in this review are:
1. **Cross-Tenant Data Exposure & IDOR:** Attempting to access, alter, delete, or link objects belonging to another user.
2. **Resource Enumeration:** Probing IDs to determine whether a resource exists on the system.
3. **Client Time & Duration Tampering:** Falsifying productivity metrics by spoofing completion timestamps or timer durations.
4. **Race Conditions & Concurrency Violations:** Bypassing single-active-timer constraints or multi-focus constraints through concurrent requests.
5. **Denial of Service & Unbounded Queries:** Exploiting sorting, filtering, or deep pagination to exhaust database worker threads.

---

## 2. Threat Analysis & Defensive Mitigations

### 2.1 Multi-Tenant Isolation & IDOR Prevention

#### Threat
An authenticated attacker attempts to read or mutate another tenant's tasks, projects, recurrence schedules, or timer sessions by supplying forged UUIDs in URLs or request payloads.

#### Defensive Architecture
1. **Database Schema Enforcement:**
   Every Phase P4 table (`tasks`, `projects`, `recurring_tasks`, `timer_sessions`) enforces a composite primary key and unique constraint on `(id, user_id)`.
   Cross-table foreign keys are composite:
   - `FOREIGN KEY (project_id, user_id) REFERENCES projects (id, user_id)`
   - `FOREIGN KEY (recurring_task_id, user_id) REFERENCES recurring_tasks (id, user_id)`
   - `FOREIGN KEY (task_id, user_id) REFERENCES tasks (id, user_id)`
   It is physically impossible in PostgreSQL for a task owned by User A to point to a project owned by User B.
2. **Repository Scoping:**
   Every SQL query unconditionally filters by `WHERE user_id = $userId`.
3. **Uniform 404 Response:**
   Per Section 14.1 of the specification, unowned resources return HTTP 404 `NOT_FOUND` identically to nonexistent resources. This completely eliminates resource enumeration vulnerabilities.

### 2.2 Client Time & Metric Tampering Prevention

#### Threat
A malicious client attempts to falsify completion times or work duration by sending arbitrary timestamps or elapsed second counts in request payloads.

#### Defensive Architecture
1. **Server-Derived Task Completion:**
   `completed_at` is never accepted in request bodies (`createTaskSchema` and `updateTaskSchema` exclude it). It is set by the server using `clock.now()` when `status === 'done'`.
2. **Server-Authoritative Timer Durations (AC-TMR-02):**
   `createTimerSessionSchema` uses Zod's `.strict()` mode. If a client attempts to pass `durationSeconds`, `elapsedSeconds`, or timestamps, the request fails with HTTP 400 `VALIDATION_ERROR`.
   Duration is derived solely from the server's timestamps:
   ```typescript
   durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
   ```
3. **Automatic Stale Timer Closure:**
   Timers left running for more than 12 hours cannot inflate tracked duration indefinitely; they are automatically closed with `end_reason = 'auto_closed'` capped at 12 hours.

### 2.3 Race Conditions & Single-Active-Timer Concurrency (AC-TMR-01)

#### Threat
An attacker issues simultaneous concurrent requests to start multiple timers or mark multiple tasks as daily focus items.

#### Defensive Architecture
1. **Database Partial Unique Indexes:**
   - Active Timers: `CREATE UNIQUE INDEX uq_timer_sessions_active ON timer_sessions (user_id) WHERE ended_at IS NULL;`
   - Daily Focus: `CREATE UNIQUE INDEX idx_tasks_one_focus_per_day ON tasks (user_id, planned_date) WHERE is_focus AND deleted_at IS NULL;`
2. **Application Level Coordination:**
   - When a new timer is started, an application check detects existing running timers and returns HTTP 409 `TIMER_ALREADY_RUNNING`. If two requests race, the database partial unique index raises a constraint violation, ensuring absolute data integrity.
   - When a task is marked focus, an atomic update unpins any other focus task for that user on that planned date before setting the new one.

### 2.4 SQL Injection & Query Hardening

#### Threat
An attacker supplies arbitrary column names or SQL fragments in query parameters (such as `sort` or `projectId`).

#### Defensive Architecture
1. **Allow-Listed Sorting (AC-TASK-05):**
   The `sort` query parameter is validated against a strict Zod enum: `['dueDate', 'priority', 'createdAt', 'updatedAt']`. Any unapproved string immediately triggers HTTP 400 `VALIDATION_ERROR`.
2. **Zero Dynamic String Concatenation:**
   All queries are constructed using Kysely type-safe query builders and tagged `sql` template literals. Raw string interpolation is completely absent.

### 2.5 Denial of Service & Rate Limiting

#### Threat
High-frequency polling or massive payload submission exhausting server resources.

#### Defensive Architecture
1. **Payload Size Ceilings:**
   - Global JSON body parser ceiling: 100 KB.
   - Task title: 300 characters.
   - Task description: 10,000 characters.
   - Project name: 120 characters.
   - Project description: 5,000 characters.
2. **Rate Limiting:**
   All Phase P4 routes are protected by authenticated user rate limiters: 300 requests per 60-second window per user.
3. **Keyset Cursor Pagination:**
   List queries use cursor-based pagination with a maximum limit of 100 items (default 25), preventing offset-based database degradation.

---

## 3. Security Test Verification Matrix

| Test Suite | Security Property Tested | Result |
| :--- | :--- | :--- |
| `tests/integration/tasks-flow.test.ts` | Cross-tenant task isolation (User B receives 404 for User A task) | **PASS** |
| `tests/integration/tasks-flow.test.ts` | Cross-tenant project isolation (User B receives 404 for User A project) | **PASS** |
| `tests/integration/tasks-flow.test.ts` | Cross-tenant project attachment prevention (composite foreign key check) | **PASS** |
| `tests/integration/tasks-flow.test.ts` | Optimistic concurrency conflict detection (`version` mismatch returns 409) | **PASS** |
| `tests/integration/tasks-flow.test.ts` | Sort allow-list enforcement (invalid sort field returns 400) | **PASS** |
| `tests/integration/tasks-flow.test.ts` | Soft-delete reminder cancellation (prevents ghost notifications) | **PASS** |
| `tests/integration/timer-sessions-flow.test.ts` | Single active timer constraint (returns 409 `TIMER_ALREADY_RUNNING`) | **PASS** |
| `tests/integration/timer-sessions-flow.test.ts` | Client duration tampering rejection (strict Zod schema rejection) | **PASS** |
| `tests/integration/timer-sessions-flow.test.ts` | Cross-tenant timer isolation (User B cannot stop User A timer) | **PASS** |
| `tests/integration/timer-sessions-flow.test.ts` | Auto-close of stale timers (> 12 hours capped with `auto_closed`) | **PASS** |

---

## 4. Audit Conclusion

The Phase P4 implementation satisfies all security requirements in Sections 14.4–14.7, 16, and 18 of the specification. Cross-tenant boundaries are strictly defended at both the application and database tiers. Client input is strictly validated, durations and completion dates are server-authoritative, and concurrency controls prevent race conditions.
