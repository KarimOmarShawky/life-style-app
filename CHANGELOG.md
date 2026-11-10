# Change log

## Unreleased — feature guide Phase 1, 2026-11-10
- E1: CI job summaries now carry evidence rows (head commit, toolchain versions, test counts parsed from runner output; "counts unavailable" instead of guesses).
- E2: npm overrides fix GHSA-3g3m-2fjr-6pw4 (glob) and GHSA-g3hv-75wg-m249 (minimatch); backend and tools/security audits report 0 vulnerabilities. Disposition table and manual rotation checklist in `docs/security/dependency-and-secret-hygiene.md`. No secret rotated.
- E9: CI localisation gate (catalog parity, placeholders, Android strings, hard-coded literal ratchet); two Android strings translated into ar/de/es/fr/tr.
- G5/G1 (backend): content-free `product_events` table, `POST /api/v1/product-events`, account opt-out and onboarding flag on `PATCH /users/me`, export/deletion coverage, 400-day retention, `PRODUCT_EVENTS_ENABLED` kill switch, Activation/D1/D7/D30 definitions (ADR-045). Production needs the owner-run SQL in `docs/analytics/sql/`; production metric values NOT RUN.

## Unreleased continuation — 2026-10-16
- Executed real owned PostgreSQL16/Redis7 integration/security and bootstrap/migration/grant probes; fixed invalid paginated push-device DELETE exposed by three live failures. No user database or Docker volume touched.
- Removed dead native Gemini upload/recording/helper scaffolding, kept OS speech/notification compatibility and existing alarms, removed unused microphone capabilities. Native build/device verification remains blocked.
- Added invalid-reset dummy-operation parity, not a complete forgot-password timing fix.
- Executed local reachable Git text history scan: 11 historical URI matches remain FAIL; no rewriting history, detector suppression or live-reuse certification.

## Unreleased — remediation work, 2026-10-15
- Hardened SMTP/reset delivery, destructive-test isolation and migration workflow.
- Repaired purge, timer, reminder, ledger validation and search edge cases.
- Required current-password proof for account export/deletion (coordinated client update).
- Introduced exact per-currency mobile arithmetic and partially integrated Digital Detox.
- Added sensitive-action fail-closed outage handling, atomic Redis quotas and actual production logging regressions.
- Removed implicit export clipboard copying; explicit informed copy remains optional (mobile unverified).
- Corrected transaction ownership/connection discard in seven auth flows and added lifecycle regressions.
- Added fail-closed source secret detection tooling/CI; historical 18/16 connection-string findings retained in the review history.
- Corrected metadata-only export claims and missing-account handling; full portability remains open.
- Reviewed all 18 source connection-string findings; removed two unsafe helper defaults, then replaced remaining local/CI application defaults with private fresh-install/per-job generation, without detector exclusions.
- Blocked known public database defaults in production URIs, guarded helper execution and loopback-bound local database/Redis/mail ports.
- Added 22 temporary-config/CLI/CI-file/Docker-spy tests and existing-install refusal/rotation runbooks; actual Docker/PostgreSQL/hosted verification remains unexecuted.
- Removed audited duplicate Dockerfile text copies and generated plugin registrant.

- Added an additive bounded NDJSON account-domain archive with explicit safe projections, a read-only repeatable snapshot, backpressure/cancellation, decimal strings and a completion hash; live SQL and native/provider behavior remain unverified.
- Bounded legacy metadata lists with explicit 413 overflow, preserving small-response compatibility without silent truncation.
- Authored a separate disposable hosted PostgreSQL/Redis verification workflow and fail-closed job-resource preflight; no hosted execution or existing policy-gate bypass claimed.

- Added Android archive source integration: bounded incremental verification, encrypted private staging, separate consented document save/readback and owned-stage cleanup; no new permission; local-audio policy was clarified in the subsequent owner decision below.
- Executed 8 Node fixture/source checks and 10 actual Android-free JVM staging/crypto checks; 25 new Flutter test cases authored but NOT RUN, full Flutter/Android/provider/device gates remain BLOCKED.

- Recorded owner clarification: existing local Focus Timer audio is allowed; server file uploads remain forbidden. Replaced the picker conflict with narrowly scoped manifest/lock/consumer checks, no global allowlist. Added 21 guard/CLI/source and 13 actual HTTP middleware regressions; native/network verification remains blocked.

This is not a production-readiness declaration or a released version. Runtime,
platform and policy blockers are listed in docs/remediation/findings.json.
