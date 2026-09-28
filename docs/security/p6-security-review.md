# Security Review — Phase P6: Calendar & Time Blocking

**Audit Date:** 2026-09-28  
**Auditor:** Lead Software Architect & Security Engineer  
**Scope:** `src/features/calendar/`, database tables `events` and `reminders`, endpoints under `/api/v1/events`  
**Classification:** Internal Technical Audit  
**Status:** PASS — Zero High / Medium Vulnerabilities Identified

---

## 1. Executive Summary

A comprehensive security review and threat analysis was conducted on the Phase P6 implementation covering Calendar Events, Time Blocking, Conflict Detection, and Linked Reminders. All endpoints, database queries, and business logic were audited against the LifeStyle App Security Invariants, OWASP API Security Top 10 (2023), and multi-tenant isolation requirements.

The implementation meets all security standards with zero critical, high, or medium severity findings.

---

## 2. Threat Analysis & Defensive Mitigations

### 2.1 Multi-Tenant Isolation & IDOR Prevention

#### Threat
An authenticated attacker attempts to query, tamper with, or delete calendar events and reminders belonging to another user.

#### Defensive Architecture
1. **Database Schema Enforcement**:
   - `events` defines `PRIMARY KEY (id, user_id)` and `UNIQUE (id, user_id)`.
   - `reminders` defines `FOREIGN KEY (event_id, user_id) REFERENCES events (id, user_id) ON DELETE CASCADE`.
   This schema-level composite key prevents any reminder from referencing an event belonging to another tenant.
2. **Repository-Level Scoping**:
   All repository methods accept `userId: string` and enforce `where('user_id', '=', userId)` on every SQL query (`findEventById`, `listEvents`, `updateEvent`, `softDeleteEvent`, `restoreEvent`, `findConflicts`, `listEventsForDay`, `deleteReminder`).
3. **404 Not Found Uniformity**:
   Attempting to access, modify, or delete another user's event returns `404 Not Found` with code `NOT_FOUND`, preventing resource enumeration.

---

### 2.2 Temporal Integrity & Logic Validation

#### Threat
Submitting malformed dates, negative durations, reminders set after event start, or invalid timezones.

#### Defensive Architecture
1. **Strict Zod Parsing**:
   - `startAt` and `endAt` are validated as ISO 8601 strings.
   - Refinements enforce `endAt >= startAt` on creation and mutation.
   - Database level `CHECK (end_at >= start_at)` provides defense-in-depth against application logic bypass.
2. **Reminder Pre-Start Constraint**:
   Service layer checks `remindAt <= startAt`. Reminders scheduled after an event has already started are rejected with `400 Bad Request`.
3. **Timezone Fallback**:
   Timezone parsing handles invalid strings gracefully, defaulting to UTC rather than crashing.

---

### 2.3 Concurrency Conflicts & Race Conditions

#### Threat
Concurrent updates overwriting user changes or corrupting event states.

#### Defensive Architecture
1. **Optimistic Locking**:
   - Every event has an integer `version` field.
   - Updates compare `WHERE version = :expectedVersion` and atomically increment `version = version + 1`.
   - Conflicting concurrent updates return `409 Conflict` (`VERSION_CONFLICT`).

---

### 2.4 Denial of Service & Ghost Reminders

#### Threat
High-frequency reminder generation, unbounded range queries, or orphaned reminders continuing to trigger alerts after event deletion.

#### Defensive Architecture
1. **Reminder Cancellation on Deletion**:
   When an event is soft-deleted, an atomic transaction updates all pending reminders to `status = 'cancelled'`. This prevents the notification dispatcher from firing ghost alerts.
2. **Rate Limiting**:
   Calendar routes are protected by authenticated user rate limits (300 requests/minute per user).
3. **Indexed Query Execution**:
   - `idx_events_user_start ON events (user_id, start_at) WHERE deleted_at IS NULL`: Ensures sub-millisecond range and conflict queries.
   - `idx_reminders_user_remind ON reminders (user_id, remind_at DESC)`: Efficient reminder sorting.

---

### 2.5 Soft-Deletion & Retention Security

#### Threat
Resurrecting long-deleted calendar events past the 30-day retention window.

#### Defensive Architecture
1. **30-Day Expiry Check**:
   `POST /events/{id}/restore` checks `deleted_at >= NOW() - INTERVAL '30 days'`. If the window has lapsed, the endpoint returns HTTP `410 Gone` (`RESTORE_WINDOW_EXPIRED`).

---

## 3. Vulnerability Assessment Summary

| Threat Category | Risk Level | Mitigation Status | Verification Method |
| :--- | :---: | :---: | :--- |
| **Cross-Tenant Event Tampering / IDOR** | High | **MITIGATED** | `calendar-flow.test.ts` (tenant isolation test) |
| **Cross-Tenant Reminder Insertion** | High | **MITIGATED** | Composite FK `(event_id, user_id)` + repository scoping |
| **Negative Duration / Invalid Time** | Medium | **MITIGATED** | Schema `CHECK (end_at >= start_at)` + Zod refinement |
| **Post-Event Reminder Scheduling** | Low | **MITIGATED** | Service-level `remindAt <= startAt` validation |
| **Ghost Notifications after Deletion** | Medium | **MITIGATED** | Transactional reminder cancellation on event deletion |
| **Concurrent Write Overwrite** | Medium | **MITIGATED** | `version` optimistic locking (returns 409) |
| **Zombie Event Restoration** | Low | **MITIGATED** | 30-day cutoff check with 410 Gone |

---

## 4. Conclusion & Audit Signoff

The Phase P6 Calendar & Time Blocking implementation meets all security standards required by the LifeStyle App Specification v1.0.1. No vulnerabilities or regressions were identified. The module is approved for production deployment.
