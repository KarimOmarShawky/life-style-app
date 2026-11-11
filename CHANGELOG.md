# Change log

## Unreleased — G6 signed-in devices, G7 widening, G2-F1, Profile localization, 2026-11-11
- G2-F1: `zonedDateTimeToUtc` (relative reminders anchored to a task's due time) now uses the UTC offset in force at the resulting instant. It was one hour off around daylight-saving changes (Cairo, Berlin; New York after the gap). It shares the notification policy's wall-clock helpers (`backend/src/core/time/wall-clock.ts`): a time in a gap moves forward, a repeated time takes its first occurrence. Tests cover Cairo, Berlin and New York, including a midnight that does not exist; 13 of them fail on the old code.
- A3: the Profile account-deletion dialog, messages, banner, status and AI tile use catalog strings in all six languages instead of hard-coded Arabic/English; the literal ratchet drops from 95 to 85.
- P1-F15 (owner decision: wire): the Profile rank card shows level, XP and progress from the Focus Shield XP ledger on this device (with a note saying so) instead of fixed numbers; nothing is shown until the ledger loads. Badges are earned from real data: first task win, first focus session, 7 days in a row with a win. Locked badges are announced to screen readers.
- G6 backend (ADR-047): `GET /api/v1/sessions` lists signed-in devices (metadata only, never `created_ip` or tokens; current session first); `POST /api/v1/sessions/{id}/revoke` signs out one device after the current-password check, revoking its refresh tokens and deleting its push devices in one transaction. Other accounts' ids answer 404; repeating is harmless; 30/60 s per user plus the shared re-authentication budget. Forward-only migration `1792770000000` and owner SQL `docs/auth/sql/auth-sessions-user-revoked.sql` add the `user_revoked` reason; before the SQL the revoke stores `logout`. Guide: `docs/auth/signed-in-devices.md`.

## Unreleased — feature guide Phase 2: G2 notification policy, 2026-11-11
- G2 (ADR-046; owner decisions recorded): one notification policy for the device and for server push. Each notification is sent, delayed out of quiet hours, combined into the day's summary, or dropped when the master switch is off. Tiers: alarm the user chose / normal reminder / low priority. Defaults change nothing until the user sets something; quiet hours suggest 22:00–07:00.
- Policy in TypeScript (`backend/src/features/notifications/notification-policy.ts`) and Dart (`lib/data/notification_policy.dart`), both run against 28 shared cases (`test/fixtures/notification_policy_cases.json`), including DST gaps and repeated hours in Cairo, Berlin and New York.
- Backend: `notification_preferences` table (forward-only migration plus owner SQL `docs/notifications/sql/notification-preferences.sql`), `GET/PUT /api/v1/notification-preferences` (auth, strict Zod, 30/60 s per user, 503 `NOTIFICATION_PREFERENCES_UNAVAILABLE` before the SQL), export and deletion coverage, archive exclusion, grants in both runtime drafts. The worker requires the policy for push (E3 gate); with no push provider nothing changes.
- App: Profile → Notifications (master switch, quiet hours, alarms during quiet hours, daily limit, account time zone note); task and calendar reminders go through a policy-aware scheduler that re-plans on every change and keeps one content-free summary per day; "Ring as an alarm" switch per timed task (default off: normal reminder, closing P0-F3); settings sync at start and resume; sign-out clears the plan and the calendar registry. 24 strings in six languages; G7 test at 200% Arabic text.
- Report: `docs/reports/feature-guide-g2-report-2026-11-11.md`. Device checks G2-1..G2-9 are NOT RUN.

## Unreleased — feature guide Phase 1, 2026-11-10
- E1: CI job summaries now carry evidence rows (head commit, toolchain versions, test counts parsed from runner output; "counts unavailable" instead of guesses).
- E2: npm overrides fix GHSA-3g3m-2fjr-6pw4 (glob) and GHSA-g3hv-75wg-m249 (minimatch); backend and tools/security audits report 0 vulnerabilities. Disposition table and manual rotation checklist in `docs/security/dependency-and-secret-hygiene.md`. No secret rotated.
- E9: CI localisation gate (catalog parity, placeholders, Android strings, hard-coded literal ratchet); two Android strings translated into ar/de/es/fr/tr.
- G5/G1 (backend): content-free `product_events` table, `POST /api/v1/product-events`, account opt-out and onboarding flag on `PATCH /users/me`, export/deletion coverage, 400-day retention, `PRODUCT_EVENTS_ENABLED` kill switch, Activation/D1/D7/D30 definitions (ADR-045). Production needs the owner-run SQL in `docs/analytics/sql/`; production metric values NOT RUN.
- Mobile (Dart/Flutter checked by hosted CI only; no local toolchain): lock-screen privacy for all four notification types (generic titles, private visibility, localised action labels; P0-F1); notification and exact-alarm permissions asked only from user actions, with an inexact fallback (P0-F5); Smart Quick Add parses on the device unless AI help is turned on in Profile after consent, 4 s AI timeout (P0-F2/F4); content-free usage events with a Profile opt-out (G5 client); first-run onboarding with starter tasks, skip, and the reminder question only after the first win (G1/E4); links opened at cold start now wait for the session restore (G3, Dart side). 38 new strings in all six languages.
- G3 home-screen widget (Kotlin and Dart checked by hosted CI only): lists the next one to three tasks for today instead of one; follows the app language (the device language if none was chosen) with strings in all six languages, replacing hard-coded English; redraws when the language, clock or time zone changes and shows a refresh hint once the day's snapshot is stale; widget and notification taps use path-form links (`lifestyle:///focus`) so a running app opens the linked screen instead of reloading home; 48dp Daily Plan tap target. Older `lifestyle://focus` links still work.
- G4/G7 habit card: the best streak stays visible after a break; a zero streak reads "Start today" or "Fresh start today" instead of "0 days"; the check-in button has a spoken label (tooltip), and a failed check-in now says so instead of failing silently; secondary text uses higher-contrast theme colours; streak status wraps and the seven-day strip scales instead of clipping at 200% text; weekday letters follow the app language (previously English letters for de/es/fr/tr). Widget tests cover Arabic RTL, 200% text, tap-target, label and contrast guidelines, and a guilt-word check across all six languages. 6 new strings in all six languages.
- G7 Profile: the rank header wraps instead of overflowing by 721 px in Arabic at 200% text, found by the new Profile switches test. Phase 1 report and handoff: `docs/reports/feature-guide-phase-1-report-2026-11-10.md`. Device checks P1-1 to P1-12 added to `docs/mobile/manual-test-checklist.md`; widget and localisation docs updated. Open owner decision: the Profile rank card and badges are static placeholders (P1-F15).

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
