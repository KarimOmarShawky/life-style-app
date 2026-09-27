# Security Review — Phase P7: Goals & Milestones

**Audit Date:** 2026-09-28  
**Auditor:** Lead Software Architect & Security Engineer  
**Scope:** `src/features/goals/`, database tables `goals` and `milestones`, endpoints under `/api/v1/goals`  
**Classification:** Internal Technical Audit  
**Status:** PASS — Zero High / Medium Vulnerabilities Identified

---

## 1. Executive Summary

A comprehensive security review and threat analysis was conducted on the Phase P7 implementation covering Goals Management, Milestones Tracking, Progress Computation, and Lifecycle Automation. All endpoints, database queries, and business logic were audited against the LifeStyle App Security Invariants, OWASP API Security Top 10 (2023), and multi-tenant isolation requirements.

The implementation meets all security standards with zero critical, high, or medium severity findings.

---

## 2. Threat Analysis & Defensive Mitigations

### 2.1 Multi-Tenant Isolation & IDOR Prevention

#### Threat
An authenticated attacker attempts to query, tamper with, or delete goals and milestones belonging to another user.

#### Defensive Architecture
1. **Composite Key Database Hardening**:
   - `goals` enforces `PRIMARY KEY (id, user_id)` and `UNIQUE (id, user_id)`.
   - `milestones` enforces `FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id) ON DELETE CASCADE`.
   This schema-level composite key prevents any milestone from referencing a goal belonging to another tenant.
2. **Repository-Level Scoping**:
   All repository methods accept `userId: string` and enforce `where('user_id', '=', userId)` on every SQL query (`findGoalById`, `listGoals`, `updateGoal`, `softDeleteGoal`, `restoreGoal`, `createMilestone`, `findMilestoneById`, `listMilestonesByGoal`, `updateMilestone`, `deleteMilestone`).
3. **Uniform 404 Responses**:
   Attempting to access, modify, or delete another user's goal or milestone returns `404 Not Found` with code `NOT_FOUND`, preventing resource enumeration attacks.

---

### 2.2 Numerical Integrity & Validation

#### Threat
Submitting malformed decimal numbers, negative targets, or attempting to assign numeric parameters to milestone goals.

#### Defensive Architecture
1. **Strict Zod Parsing & Regex**:
   - `targetValue` and `currentValue` are validated as decimal strings conforming to `^\d+(\.\d{1,4})?$`.
   - Floating-point representations are strictly forbidden.
2. **Database Level CHECK Constraints**:
   - `CHECK ((progress_type = 'numeric' AND target_value > 0 AND current_value >= 0) OR (progress_type = 'milestones' AND target_value IS NULL AND current_value IS NULL AND unit IS NULL))`.
   - Attempts to violate these constraints fail immediately at the database engine level.

---

### 2.3 Concurrency Conflicts & Race Conditions

#### Threat
Concurrent updates overwriting user modifications or corrupting milestone completion state.

#### Defensive Architecture
1. **Optimistic Locking**:
   - `goals` and `milestones` carry integer `version` fields.
   - Updates compare `WHERE version = :expectedVersion` and atomically increment `version = version + 1`.
   - Conflicting concurrent updates return `409 Conflict` (`VERSION_CONFLICT`).

---

### 2.4 Soft-Deletion & Retention Security

#### Threat
Resurrecting long-deleted goals past the 30-day retention window.

#### Defensive Architecture
1. **30-Day Expiry Check**:
   `POST /goals/{id}/restore` checks `deleted_at >= NOW() - INTERVAL '30 days'`. If the window has lapsed, the endpoint returns HTTP `410 Gone` (`RESTORE_WINDOW_EXPIRED`).

---

## 3. Vulnerability Assessment Summary

| Threat Category | Risk Level | Mitigation Status | Verification Method |
| :--- | :---: | :---: | :--- |
| **Cross-Tenant Goal Tampering / IDOR** | High | **MITIGATED** | `goals-flow.test.ts` (tenant isolation test) |
| **Cross-Tenant Milestone Injection** | High | **MITIGATED** | Composite FK `(goal_id, user_id)` + repository scoping |
| **Numeric Value Tampering / Floats** | High | **MITIGATED** | Decimal regex + SQL `NUMERIC(18,4)` constraints |
| **Milestone / Numeric Type Inversion** | Medium | **MITIGATED** | Zod refinements + database CHECK constraint |
| **Concurrent Write Overwrite** | Medium | **MITIGATED** | `version` optimistic locking (returns 409) |
| **Zombie Goal Restoration** | Low | **MITIGATED** | 30-day cutoff check with 410 Gone |

---

## 4. Conclusion & Audit Signoff

The Phase P7 Goals & Milestones implementation meets all security standards required by the LifeStyle App Specification v1.0.1. No vulnerabilities or regressions were identified. The module is approved for production deployment.
