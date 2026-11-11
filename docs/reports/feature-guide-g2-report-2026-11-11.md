# Feature guide G2 — notification policy: report and handoff (2026-11-11)

> **Historical snapshot** — describes branch `arena/db60a1d0-life-style-app` (PR #30)
> from `7fd822a` through code commit `4448272` on 2026-11-11. Every status applies to those
> commits only. Re-verify after any later change. This is not a release approval.

## 1. Verdict

| Scope | Status |
|---|---|
| G2 (CAREFUL, approved 2026-11-11) | **Implemented.** Every hosted CI gate passed on `4448272`. |
| Device behaviour | **NOT RUN.** No phone in this environment; checks G2-1..G2-9 are in `docs/mobile/manual-test-checklist.md`. |
| Production database | **G2 SQL not applied yet.** Until it is, the API degrades safely (§8). |
| Program verdict (guide handoff) | **NO-GO** for a public release, unchanged: no signed release build, no device matrix, Phase 3 not started. |

## 2. Owner decisions (2026-11-11, ask_user)

- G2 is the next item after Phase 1, in the same PR. Merge after G2 is finished.
- Quiet hours are **off until the user turns them on**; 22:00–07:00 is suggested.
- A timed task is a **normal notification**; it rings as an alarm only when the user
  turns on "Ring as an alarm" for that task (this closes Phase 0 finding P0-F3).
- **No daily limit** until the user sets one; reminders over the limit are combined
  into one summary instead of being lost.
- Guide rule kept: alarms break quiet hours only when the user allows it.

Recorded in ADR-046 (`docs/architecture/design-decisions.md`).

## 3. Done-when and checklist (guide G2)

| Item | Evidence | Status |
|---|---|---|
| No non-critical notification in quiet hours | Shared cases (26 decisions, 2 summaries) pass in TypeScript and Dart; a 10-minute sweep across Cairo, Berlin and New York during three DST periods; scheduler and worker tests | PASS (CI), device NOT RUN |
| Digests work | Device: one content-free summary per local day (scheduler tests). Server push: one summary for the rest of the day (unit and PostgreSQL tests) | PASS (CI), device NOT RUN |
| Daily limit enforced | Scheduler test (limit 2 → 2 individual, 1 summary); worker counts pushes sent that local day | PASS (CI) |
| E3 gated | `processReminderDispatch` requires a `PushPolicyStore`; `push-policy-gate.test.ts` covers send, defer, cancel and summary; with no provider nothing changes (F-04) | PASS (CI) |
| Migration + Zod endpoint | `1792760000000_notification_preferences`, `GET/PUT /api/v1/notification-preferences` (auth, strict Zod, 30/60 s per user) | PASS (CI) |
| Policy module | `notification-policy.ts` and `notification_policy.dart` | PASS (CI) |
| Wire local scheduler | `notification_scheduler.dart`: task and calendar reminders | PASS (CI), device NOT RUN |
| Wire worker push | Policy-gated push path; push itself stays unavailable until E3 | PASS (CI) |
| DST / time-zone tests | Gaps, repeated hours, days whose midnight does not exist, unknown zones | PASS (CI) |
| Owner decision recorded | ADR-046 | PASS |
| G7 for the new screen | Arabic, 200% text, RTL, tap targets, labels and contrast (`notification_settings_screen_test.dart`) | PASS (CI) |

## 4. CI ledger (hosted runs on each commit)

| Commit | CI Pipeline | Isolated backend | Secret detection | Note |
|---|---|---|---|---|
| `630fbe6` (docs: G5 SQL applied) | — | — | — | Docs only; covered by the next run |
| `7fd822a` policy core | 43060484350 ✓ | 43060485780 ✓ | 43060484854 ✓ | |
| `a0300c7` backend | 43064297011 ✗ | 43064296984 ✗ | 43064297118 ✓ | One integration test dropped a table the CI role does not own |
| `3b6f69c` app | 43067136964 ✗ | 43067137033 ✓ | 43067136914 ✓ | Backend gate ✓; Dart format and settings tests hung (fake-async zone) |
| **`4448272`** fixes | **43069272541 ✓** | **43069272185 ✓** | **43069272180 ✓** | All jobs incl. format, analyze, Flutter tests, Kotlin, debug APK |

Local on the backend commit: unit 53 files / 554 tests, Prettier, ESLint, `tsc` (source and
tests), `openapi:check`, root tests 191/191, docs, l10n, forbidden-surface and secret scan.
Dart, Flutter and Kotlin were checked by hosted CI only (no local toolchain).

## 5. Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| P0-F3 | Low | Every timed quick-add was an insistent alarm | **Fixed**: normal reminder by default; alarm only by choice |
| G2-F1 | Low | `zonedDateTimeToUtc` (`backend/src/core/time/date-utils.ts`) reads the UTC offset at the wrong instant, so local times in the hours just before a DST change convert one hour off (affects relative reminders anchored to a task's due time) | **Open**; outside G2. Fix by reusing the policy's wall-clock helper, with tests |
| G2-F2 | Low | Calendar reminders and their registry survived sign-out, so the next account on the device could get them | **Fixed**: sign-out cancels the plan and clears the registry |
| G2-F3 | Info | The app never declared `USE_FULL_SCREEN_INTENT`, so "alarms" were always ringing banners | Documented; no Play full-screen declaration needed |

## 6. Security and privacy

- The endpoint is authenticated, strictly validated (unknown fields rejected), rate
  limited per user and scoped to the caller's own row (no ids in the path).
- The server stores settings only, never notification text. Logs carry no user data.
- Settings are in the account metadata export, erased with the account, and a documented
  exclusion from the v1 archive file. Both runtime-grant drafts grant CRUD on the table.
- On the device, the plan stores upcoming reminders' times, tiers and text in
  SharedPreferences, like the existing calendar registry, so they can be re-planned.
  Sign-out clears it. Summary notifications are content-free.
- No new dependency, SDK, permission or analytics. No Money surface touched.

## 7. Files

Backend: `backend/src/features/notifications/*` (policy, validation, repository, service,
controller, routes), `backend/src/jobs/job-processors.ts`, `backend/src/jobs/job-stores.pg.ts`,
`backend/src/worker.ts`, `backend/src/app.ts`, `backend/src/container.ts`,
`backend/src/features/users/{users.repository.pg,users.types,account-archive.sources}.ts`,
`backend/src/core/errors/app-error.ts`, migration `1792760000000_notification_preferences.cjs`,
`schema.sql` and `schema-sql.ts`, OpenAPI. Tests: `notification-policy`,
`notification-preferences`, `push-policy-gate` (unit), `notification-preferences-flow`
(integration), updated role, export and job tests.

App: `lib/data/notification_{policy,scheduler,preferences}.dart`,
`lib/features/notifications/notification_settings_screen.dart`,
`lib/data/notification_service.dart`, `lib/data/api_client.dart`,
`lib/features/tasks/presentation/tasks_screen.dart`,
`lib/features/calendar/data/calendar_reminder_notifications.dart`,
`lib/features/auth/{presentation/profile_screen,state/auth_provider}.dart`,
`lib/features/home/presentation/home_shell.dart`, six catalogs (24 strings each). Tests:
`notification_policy_test`, `notification_scheduler_test`,
`notification_settings_screen_test`, updated `notification_privacy_contract_test`;
shared fixture `test/fixtures/notification_policy_cases.json`.

Docs: ADR-046, `docs/notifications/notification-preferences.md` (with the owner SQL and
verification queries), `docs/notifications/sql/notification-preferences.sql`,
`docs/database/migrations.md`, `docs/api/{errors,account-archive}.md`,
`docs/remediation/drafts/*`, `docs/mobile/manual-test-checklist.md`, `CHANGELOG.md`.

## 8. Rollout and rollback

- **Backend deploy without the SQL** is safe: reading settings returns the defaults with
  `available: false`, saving answers 503 `NOTIFICATION_PREFERENCES_UNAVAILABLE`, export and
  deletion skip the table, and the worker is unchanged because push is unavailable.
- **App version with the settings screen:** publish only after the SQL is applied.
  Before that, the screen shows a notice and cannot save.
- **Rollback:** the migration is forward-only and additive. The endpoint is unused until
  the new app version ships; with the default settings the policy changes nothing except
  that new timed tasks are normal reminders unless the user chooses an alarm.

## 9. Owner actions

1. Apply `docs/notifications/sql/notification-preferences.sql` on Neon: a rehearsal branch
   first, then production, with the verification queries (`t, t, t, t` and `0`).
2. Device pass: G2-1..G2-9 and P1-1..P1-12.
3. Still due from G5: re-run the onboarding backfill line right before publishing the app
   version with onboarding.
4. Optional: native-speaker review of the 24 new strings.
5. Next items need separate approval: E3 (push provider; now gated by G2), G6, G4 grace,
   E5, E7, and a fix for G2-F1.
