# Remediation progress — 2026-11-04

## Release verdict: NO-GO

This is an **incomplete fix pass**, not a release certification. P0-1 remains open and P0-2 is partially remediated, with remaining limitations described below. Several P1 families remain open or lack their required end-to-end proof. The independent audit report named in the request is absent from this checkout, so its §5 R-1…R-12 mapping cannot be verified; the prompt's P0/P1 identifiers are used below rather than inventing a mapping. Base: `9448f1e64d876122610fac1a82a025794bbacbab`. Work branch: `arena/59b3c606-life-style-app`.

## Changes and proof

### P0-2 — money invariants: partial

**Root cause:** Validation rounded stored values or checked a different amount from the one inserted; subscription and budget partial updates did not validate effective currency and categories, and the transaction repository could bypass lock-time validation without a user date.

**Fix:** `money.invariants.ts:65-105` checks request strings without rounding, validates stored numeric precision without changing the value, and checks category kind/archive status. `money.service.ts:363,540,625,825` passes effective values and the exact validated payment amount/date. `money.repository.pg.ts:572,815,905,1114` validates effective amounts under row locks, and locks category reads against concurrent archive; a missing validation date fails closed for transaction updates. Budget creation rejects archived categories.

**Failing-first proof:** Against a disposable PostgreSQL 16.15 database with forward migrations, `npm --prefix backend test -- tests/integration/money-effective-record-regression.test.ts` initially reported `5 failed | 3 passed`: locked transaction currency, invalid JPY payment, invalid JPY subscription amount, archived subscription category and invalid JPY budget update were all accepted. Subsequent failing-first additions exposed three repository lock-time failures (`3 failed | 8 passed`), archived-category payment (`1 failed | 12 passed`), omitted transaction validation date (`1 failed | 13 passed`), and a JPY payment override with trailing decimals (`1 failed | 14 passed`). A same-or-wider currency regression test also first failed (`1 failed | 11 passed`) and then passed. After fixes the file reports `15 passed`, including the required untouched rows and exact payment amount. Existing `money-flow.test.ts` and `money-invariants.test.ts` passed in the same run (`35 passed` total).

**Precision policy and residual:** PostgreSQL `NUMERIC(19,4)` always returns four fractional digits, losing the original textual scale. Strict raw scale validation of every stored value would reject ordinary USD and JPY rows even when the numerical value is valid. The implementation validates the verbatim stored value by its significant fractional digits when currency precision is unchanged or increased, while requiring an explicit amount on a change to a narrower currency. This is a documented exception to treating all stored trailing zeros as request-supplied scale, and preserves the specified USD-to-JPY 400 acceptance cases without rounding. Some regression tests exercise service/repository errors rather than the HTTP 400 envelope; there is no actual concurrent-writer race test, and payment scheduling still derives the next billing date before the lock. These are not a complete P0 sign-off.

### P1-1 — DATE boundary: partial

**Root cause:** `pg`'s default DATE parser returns `Date`, despite the Kysely DATE declarations being strings; goal partial-update comparison could compare a `Date` to a string, and relative reminders expect a string.

**Fix:** `backend/src/infrastructure/database/postgres/pool.ts:16` registers the OID 1082 string parser (option A). `backend/src/features/goals/goals.service.ts:105` normalizes both effective dates before comparison, including legacy `Date` values.

**Failing-first proof:** `npm --prefix backend test -- tests/unit/date-pg-boundary-regression.test.ts` before the fix: `2 failed`; parser assertion received `2026-02-03T00:00:00.000Z` instead of `'2026-02-03'`; the goal test received HTTP status 409 instead of 400. After: `2 passed`. The goal test uses a stub repository, not a database.

**Regression risk / residual:** Globally changing the parser affects every PostgreSQL DATE consumer; the full existing PostgreSQL integration suite passed, but the requested new relative-reminder and partial-goal HTTP acceptance tests were not added or run. Do not consider the P1 acceptance criteria satisfied until those are exercised, including existing DATE consumers.

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
- **P0-2 money invariants:** partial; see the real-database proof and remaining HTTP/concurrency/precision-policy limitations above.
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
| `npm run test:unit` (backend) | EXECUTED | 46 files, 453 tests passed in the earlier run; the complete run below includes the unit suite. |
| `npm test` (backend) | EXECUTED | With isolated local PostgreSQL 16.15 and Redis 7.2.11, `lifestyle_app` runtime role, dedicated `lifestyle_test` database and Redis database 15: 70 files, 634 tests passed. An earlier run before provisioning was blocked by the destructive-test safety guard; a first provisioned run with the superuser failed the least-privilege assertion, then passed using the runtime role. |
| `node --test scripts/*.test.mjs` | EXECUTED | 145 passed, 0 failed. This includes a known blind AI source contract and is not AI behavior proof. |
| `npm run openapi:generate` | EXECUTED | Generated file had no diff; no generator changes were made. |
| `npm audit --omit=dev --audit-level=high` | EXECUTED | Exit 0; 3 moderate production advisories remain. No threshold was lowered. |
| `migrate:up` twice and existing repository/endpoint tests | EXECUTED | Provisioned disposable local PostgreSQL 16.15 and Redis 7.2.11; fresh migrations completed and repeated `migrate:up` reported `No migrations to run!`. PostgreSQL/Redis artifacts are outside the repository. The required new reminder/goal HTTP acceptance tests are still missing. |
| Flutter format/analyze/test | BLOCKED | `flutter` and `dart` are absent. |
| Android unit tests / APK verification | BLOCKED | Java, Gradle, Android SDK and Flutter are absent. |
| Hosted CI on this branch | EXECUTED | User-triggered run [41920536221](https://github.com/KarimOmarShawky/life-style-app/actions/runs/41920536221) succeeded on `arena/59b3c606-life-style-app` at commit `6de3db6`. Backend gate, Flutter formatting/analyze/test, Kotlin JVM tests, debug APK build and signature verification passed. The signed-release build was skipped by workflow condition. This run predates this documentation-only update and is not evidence that the open AI defect was fixed. Direct `gh workflow run` from this session had returned HTTP 403. |

## Corrections / qualifications

- The prompt reports audit totals of 15 PASS / 8 FAIL / 1 mixed, rather than 12/10. The missing audit report prevents independently checking its §5 IDs or its summary.
- The prompt describes `10.00` USD → JPY as a "perfectly legal currency change" yet its acceptance test explicitly requires 400 for that exact scale. These statements are inconsistent; the numerical amount and the serialized-scale rule need a deliberate decision before implementation.
- The DATE parser change required correcting two existing integration assertions that assumed the old runtime type: `expect(taskAfter.rows[0].occurrence_date.toISOString().slice(0, 10)).toBe('2026-09-27')` and `expect(txAfter.rows[0].billing_date.toISOString().slice(0, 10)).toBe('2026-09-01')`. They now assert the exact same preserved days as strings, not weaker outcomes; these database tests remain blocked locally. No migration was modified. The targeted schema test does not establish full schema equivalence.
