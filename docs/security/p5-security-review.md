# Security Review — Phase P5: Habits & Daily Progress

**Audit Date:** 2026-09-28  
**Auditor:** Lead Software Architect & Security Engineer  
**Scope:** `src/features/habits/`, database tables `habits` and `habit_checkins`, endpoints under `/api/v1/habits`  
**Classification:** Internal Technical Audit  
**Status:** PASS — Zero High / Medium Vulnerabilities Identified

---

## 1. Executive Summary

A comprehensive security review and threat analysis was conducted on the Phase P5 implementation covering Habit Management, Check-ins, Streak Computation, and Daily Progress aggregation. All endpoints and data access paths were audited against the LifeStyle App Security Invariants, OWASP API Security Top 10 (2023), and multi-tenant isolation requirements.

The implementation meets all security requirements with zero critical, high, or medium severity findings.

---

## 2. Threat Analysis & Defensive Mitigations

### 2.1 Multi-Tenant Isolation & IDOR Prevention

#### Threat
An authenticated attacker attempts to query, tamper with, or delete habits and check-in records belonging to another tenant by providing arbitrary UUIDs in URL paths or request payloads.

#### Defensive Architecture
1. **Database Schema Hardening**:
   Every table enforces composite foreign keys guaranteeing ownership integrity:
   - `habits (id, user_id)` has a unique constraint `uq_habits_id_user_id`.
   - `habit_checkins` enforces `CONSTRAINT fk_habit_checkins_habits FOREIGN KEY (habit_id, user_id) REFERENCES habits (id, user_id) ON DELETE CASCADE`.
   This schema-level constraint prevents check-ins from being created or linked under mismatched user identities even if application logic were compromised.
2. **Repository Scoping**:
   All repository methods accept `userId: string` and mandate `where('user_id', '=', userId)` on every SQL query (`getHabitById`, `listHabits`, `updateHabit`, `softDeleteHabit`, `restoreHabit`, `upsertCheckin`, `listCheckinsForHabit`, `deleteCheckin`).
3. **Uniform 404 Responses**:
   Accessing an unowned or nonexistent habit ID yields identical HTTP `404 Not Found` responses with error code `HABIT_NOT_FOUND`, preventing resource enumeration attacks.

---

### 2.2 Temporal Integrity & Anti-Tampering

#### Threat
Clients attempt to manipulate streak counts or historical records by submitting future check-ins, backdating check-ins prior to habit creation, or submitting check-ins for unscheduled days.

#### Defensive Architecture
1. **Server-Authoritative Date Evaluation**:
   The server determines the current calendar date in the user's configured IANA timezone (retrieved from `req.user.timezone`).
2. **AC-HAB-03 Enforcement**:
   Check-in dates are validated against `getUserTodayDate(userTimezone)`. Any date $D > \text{userToday}$ is immediately rejected with HTTP `400 Bad Request` (`CANNOT_CHECKIN_FUTURE_DATE`).
3. **Habit Lifecycle Boundaries**:
   Check-ins submitted for dates earlier than `habit.start_date` or later than `habit.end_date` are rejected with `400 Bad Request`.
4. **Schedule Adherence Validation**:
   The habit's recurrence rule is checked via `isScheduledDate(habit, date)`. Check-ins on non-scheduled days are rejected.

---

### 2.3 Input Validation & Injection Prevention

#### Threat
Malicious payloads containing SQL fragments, prototype pollution, oversized strings, or invalid enum values.

#### Defensive Architecture
1. **Strict Zod Schema Validation**:
   - `title`: trimmed string, 1 to 255 characters.
   - `color`: validated against strict hex regex `^#[0-9A-Fa-f]{6}$`.
   - `frequencyType`: restricted strictly to allowed enum set (`daily`, `weekly`, `monthly`, `days_per_week`, `days_per_month`).
   - `daysOfWeek`: array of integers within `[1, 7]`.
   - `targetPerDay`: positive integer $\ge 1$.
   - `status`: restricted to `done`, `skip`, or `fail`.
   - `date`: validated against ISO calendar regex `^\d{4}-\d{2}-\d{2}$` and parsed into valid calendar components.
2. **Parameterized Kysely Queries**:
   Zero raw string interpolation is used. All SQL queries execute via Kysely's type-safe query builder, ensuring complete protection against SQL injection.

---

### 2.4 Denial of Service & Resource Exhaustion

#### Threat
High-frequency check-in updates or massive habit lists causing CPU exhaustion or connection pool depletion.

#### Defensive Architecture
1. **Tiered Rate Limiting**:
   Habit routes are protected by authenticated user rate limits (standard tier: 120 requests/minute per user).
2. **Optimized Database Indexes**:
   - `idx_habits_user_active ON habits (user_id, is_archived, sort_order) WHERE deleted_at IS NULL`: Enables index-only scans for listing active habits.
   - `idx_habit_checkins_user_date ON habit_checkins (user_id, date)`: Supports constant-time retrieval for daily progress calculations.
   - `uq_habit_checkins_habit_date UNIQUE (habit_id, date)`: Backed by a unique B-tree index ensuring $O(\log n)$ upsert performance.
3. **Pure Functional Streaks Engine**:
   Streak recalculation is bound to scheduled dates within the habit's lifetime (capped at max 365 backward iterations), guaranteeing sub-millisecond computation time in memory.

---

### 2.5 Soft-Deletion & Lifecycle Security

#### Threat
Unauthorized restoration of long-deleted records or phantom access to soft-deleted entities.

#### Defensive Architecture
1. **30-Day Restoration Window**:
   When restoring a soft-deleted habit via `POST /habits/{id}/restore`, the repository verifies `deleted_at >= NOW() - INTERVAL '30 days'`. If the window has lapsed, the service returns HTTP `410 Gone` (`RESTORE_WINDOW_EXPIRED`).
2. **Check-in Persistence During Soft Delete**:
   Check-in records remain associated with the soft-deleted habit so that restoration restores full historical streak fidelity. Hard deletion occurs only on user account cascade deletion.

---

## 3. Vulnerability Assessment Summary

| Threat Category | Risk Level | Mitigation Status | Verification Method |
| :--- | :---: | :---: | :--- |
| **IDOR / Cross-Tenant Habit Mutation** | High | **MITIGATED** | `habits-flow.test.ts` (tenant isolation test) |
| **Cross-Tenant Check-in Creation** | High | **MITIGATED** | Composite FK `(habit_id, user_id)` + repository scoping |
| **Future Date Check-in Tampering** | Medium | **MITIGATED** | Server-side timezone comparison + 400 rejection |
| **Unscheduled Check-in Forgery** | Low | **MITIGATED** | Recurrence schedule validation in service |
| **SQL Injection** | High | **MITIGATED** | Kysely query builder parameterized queries |
| **Unbounded Query DoS** | Medium | **MITIGATED** | User rate limiting + composite indexes |
| **Zombie Habit Restoration** | Low | **MITIGATED** | 30-day cutoff enforcement with 410 Gone |

---

## 4. Conclusion & Audit Signoff

The Phase P5 Habits implementation meets all security criteria required by the LifeStyle App Specification v1.0.1. No security regressions or vulnerabilities were identified. The module is approved for production deployment.
