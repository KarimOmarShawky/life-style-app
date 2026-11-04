# Remediation progress — 2026-11-04

## Release verdict: NO-GO

This is an **incomplete fix pass**, not a release certification. Both P0 families remain open. Several P1 families remain open or lack their required end-to-end proof. The independent audit report named in the request is absent from this checkout, so its §5 R-1…R-12 mapping cannot be verified; the prompt's P0/P1 identifiers are used below rather than inventing a mapping. Base: `9448f1e64d876122610fac1a82a025794bbacbab`. Work branch: `arena/59b3c606-life-style-app`.

## Changes and proof

### P1-1 — DATE boundary: partial

**Root cause:** `pg`'s default DATE parser returns `Date`, despite the Kysely DATE declarations being strings; goal partial-update comparison could compare a `Date` to a string, and relative reminders expect a string.

**Fix:** `backend/src/infrastructure/database/postgres/pool.ts:16` registers the OID 1082 string parser (option A). `backend/src/features/goals/goals.service.ts:105` normalizes both effective dates before comparison, including legacy `Date` values.

**Failing-first proof:** `npm --prefix backend test -- tests/unit/date-pg-boundary-regression.test.ts` before the fix: `2 failed`; parser assertion received `2026-02-03T00:00:00.000Z` instead of `'2026-02-03'`; the goal test received HTTP status 409 instead of 400. After: `2 passed`. The goal test uses a stub repository, not a database.

**Regression risk / residual:** Globally changing the parser affects every PostgreSQL DATE consumer; unit tests passed, but real PostgreSQL reminder creation/update and goal HTTP tests were not run. Do not consider the P1 acceptance criteria satisfied until those are exercised, including existing DATE consumers.

### P1-3 — list cursors: partial

**Root cause:** Three repositories silently ignored decode errors and permitted non-UUID IDs to reach PostgreSQL; SQLSTATE `22P02` fell through to 500.

**Fix:** `backend/src/core/http/created-at-cursor.ts:4` validates the emitted base64 JSON format, UUID and ISO timestamp; habits, projects and recurring-task list repositories call it before execution (`habits.repository.pg.ts:245`, `projects.repository.pg.ts:184`, `recurring-tasks.repository.pg.ts:317`). `backend/src/core/middleware/error-handler.ts:174` maps `22P02` to a safe 400.

**Failing-first proof:** `npm --prefix backend test -- tests/unit/list-cursor-regression.test.ts` before: `4 failed`, with all three invalid cursor cases resolving instead of rejecting and the SQLSTATE handler returning 500 instead of 400. After: `4 passed`. Tests use stub query builders and a real Express error-handler request; they do not exercise authenticated endpoints with PostgreSQL.

**Regression risk / residual:** Invalid or old cursors that were previously ignored now produce 400, intentionally. The decoder accepts the canonical timestamps emitted by these repositories; verify successful pagination and malformed-cursor HTTP responses against a real database before release.

### P1-6 — reset schema snapshots: partial

**Root cause:** The snapshots omitted the columns, foreign key and indexes introduced by migration `1792400000000_password_reset_ownership_and_fencing.cjs`; the existing guard only compared table names.

**Fix:** Added `lease_token`, `user_id`, the named ownership FK and both indexes to `schema.sql:763` and the `SCHEMA_SQL` snapshot in `backend/src/infrastructure/database/postgres/schema-sql.ts:16`. No applied migration was changed. Added a targeted snapshot assertion in `backend/tests/unit/startup-ddl-guard.test.ts`.

**Failing-first proof:** `npm --prefix backend test -- tests/unit/startup-ddl-guard.test.ts` before: `1 failed | 5 passed`, with `expected ... to match /\\blease_token\\s+UUID\\b/i`. After: `6 passed`.

**Regression risk / residual:** PostgreSQL execution and reset repository compatibility remain untested locally. The new guard is targeted: it is **not** the requested comprehensive bidirectional comparison of columns and constraints across all migrations and snapshots. That gate-integrity work remains open.

### P1-7 — background error minimization: partial

**Root cause:** The logger serializes raw `Error.message` and `stack`, and reminder dispatch stored the provider's raw message.

**Fix:** Pool, transaction after-commit hooks, audit logging and worker pool/shutdown/uncaught-exception handlers now use `summarizeErrorForLog` (`pool.ts:37,65`, `transaction-runner.ts:48`, `audit-logger.ts:59`, `worker.ts:78,296,305`). Reminder failures store the fixed message at `backend/src/jobs/job-processors.ts:152` instead of provider content.

**Failing-first proof:** `npm --prefix backend test -- tests/unit/log-minimization.test.ts tests/unit/job-processors.test.ts` before: `2 failed | 18 passed`: captured audit/after-commit logs and reminder retry details contained the test email. After: `20 passed`.

**Regression risk / residual:** Provider-specific failure text is intentionally no longer stored, reducing diagnostics. The worker's unhandled-rejection handler at `worker.ts:309` still passes the raw reason; a complete background/error-path audit and tests for every site remain open. Existing job processor tests cover retry/failure behavior.

## Open defects and gate work

- **P0-1 AI streaming and voice:** not changed; buffered endpoint/SSE mismatch, error-channel conflation, nonfunctional speech, consent localization, and blind contract test remain open. Dart behavioral tests were not run.
- **P0-2 money invariants:** not changed; transaction, payment, subscription, budget, category, and locked-row validation issues and required real-database tests remain open. `NUMERIC(19,4)` produces padded decimal strings, so applying strict raw-string scale checks to every stored value without addressing that representation can reject otherwise ordinary updates; this needs an explicitly tested policy rather than an unverified quick change.
- **P1-2 completed date range/OpenAPI:** not changed; timezone-aware bounds and documentation/test are open.
- **P1-4 password reset:** not changed; lease release, reusable valid code, atomic attempt counting, SMTP throttling and delivery/retry tests remain open.
- **P1-5 wallet queue/analyzer/sanitizer:** not changed; all five subissues and mobile/native tests remain open.
- **P1-6/P1-7:** partial, as detailed above.
- **Gate integrity:** no validation-schema-to-OpenAPI route coverage guard was added; AI contract remains source-based; full migration-to-snapshot column/constraint drift guard remains open.
- **P2:** ledger, analytics egress/consent, documentation, moderate advisories and test gaps remain open.

## Verification

| Gate | State | Observed result / exact blocker |
|---|---|---|
| `npm --prefix backend ci` | EXECUTED | Passed; npm reported 9 moderate vulnerabilities across all dependencies. |
| `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `npm run format:check` (backend) | EXECUTED | All passed after formatting. |
| `npm run test:unit` (backend) | EXECUTED | 46 files, 453 tests passed. |
| `npm test` (backend) | BLOCKED | Attempted: 451 tests passed, 23 integration/security suites failed during setup with `Destructive tests require ALLOW_DESTRUCTIVE_TESTS=isolated-resources-only`. No isolated PostgreSQL or Redis services are available; do not override the guard against an unsafe target. |
| `node --test scripts/*.test.mjs` | EXECUTED | 145 passed, 0 failed. This includes a known blind AI source contract and is not AI behavior proof. |
| `npm run openapi:generate` | EXECUTED | Generated file had no diff; no generator changes were made. |
| `npm audit --omit=dev --audit-level=high` | EXECUTED | Exit 0; 3 moderate production advisories remain. No threshold was lowered. |
| `migrate:up` twice and real repository/endpoint tests | BLOCKED | No PostgreSQL server, `psql`, or Docker. Redis-dependent tests also lack `redis-server`. |
| Flutter format/analyze/test | BLOCKED | `flutter` and `dart` are absent. |
| Android unit tests / APK verification | BLOCKED | Java, Gradle, Android SDK and Flutter are absent. |
| Hosted CI on this branch | BLOCKED | Branch push succeeded, but workflows only trigger on pushes to main or PRs. Manual `gh workflow run ci.yml --ref arena/59b3c606-life-style-app` returned HTTP 403 `Resource not accessible by integration`; no run was created. Base run `41891335687` was confirmed successful on `9448f1e`, but does **not** verify these changes. GitHub Actions dispatch permissions need attention. |

## Corrections / qualifications

- The prompt reports audit totals of 15 PASS / 8 FAIL / 1 mixed, rather than 12/10. The missing audit report prevents independently checking its §5 IDs or its summary.
- The prompt describes `10.00` USD → JPY as a "perfectly legal currency change" yet its acceptance test explicitly requires 400 for that exact scale. These statements are inconsistent; the numerical amount and the serialized-scale rule need a deliberate decision before implementation.
- No existing assertion was weakened or deleted. No migration was modified. The targeted schema test does not establish full schema equivalence.
