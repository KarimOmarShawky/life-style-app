# G6 signed-in devices, G7 widening, G2-F1, Profile localization — report (2026-11-11)

> **Historical snapshot** — work on branch `arena/1cb3ca6e-life-style-app` (draft PR #31),
> started from `main` at `f4fe7f2`, 2026-11-11. Evidence below is tied to the cited commits.
> This is not a release approval: device behaviour, production SQL and the signed
> release are NOT RUN here.
>
> **Update — 2026-11-11: G2 and G6 owner SQL applied to production (owner-reported).** The
> owner rehearsed both files on a Neon branch of production, then applied them to production;
> the verification queries returned the expected values (`t, t, t, t` and `0`; `1, 1` and
> `0`). Not verified independently: this environment has no database access.

Source prompt: `LifeStyle_Next_Step_Prompt_G6_and_Closure.pdf`. Step 0 audit:
`docs/reports/feature-guide-g6-g7-step0-audit-2026-11-11.md`.

## 1. Owner decisions (2026-11-11)

- Batch A (SAFE NOW) approved in full: A1 G2-F1, A2 G7 widening, A3 Profile localization.
- G6 (CAREFUL) approved as designed in the Step 0 audit.
- P1-F15: wire the rank card and badges to the real XP ledger on the device.
- CI toolchain (asked when Flutter 3.50.0 broke the analyzer, see §6 CI-F1): pin Flutter 3.47.9.

## 2. Verdict

NO-GO for a public release, unchanged. Everything approved is implemented and passes
hosted CI (see §4), but the device checklist and the signed release are NOT RUN. The
G2 and G6 production SQL was applied by the owner on 2026-11-11 (owner-reported).

## 3. What changed, item by item

**A1 — G2-F1 fixed** (`88967f0`)
- `zonedDateTimeToUtc` now uses the offset in force at the resulting instant. The policy's wall-clock helpers moved to `backend/src/core/time/wall-clock.ts`, so a time in a gap moves forward and a repeated time takes its first occurrence.
- `backend/tests/unit/zoned-date-time.test.ts`: 26 tests. They cover gaps, repeated hours and a midnight that does not exist (Cairo 24 Apr), in Cairo, Berlin and New York, plus a half-hour sweep of 12 transition days.
- 13 of these tests fail on the old code (executed locally).

**A3 — Profile localized** (`4100fca`)
- 10 hard-coded Arabic/English pairs became catalog keys in all six languages: the deletion dialog, messages, banner and status, the AI tile, and the delete tile.
- The literal ratchet went down from 95 to 85; Profile is now at 0.

**A4 — P1-F15 wired** (`4100fca`, format fix `e73a36b`)
- Level, XP and progress come from the Focus Shield XP ledger on the device, with a note saying so. Nothing is shown before the ledger loads.
- Badges are earned from real data: a task win, a focus session, and 7 days in a row with a win.
- Locked badges are announced to screen readers and use an accessible colour.
- Tests: `test/xp_ledger_test.dart` and the Profile tests.

**A2 — G7 widened** (`6e34cbb`; fixes in `54e058a`, `6abe9a0`, `5bb67d2`, `7f229da`, `ad5d909`)
- **Home tab bar:** a separate `HomeNavigationBar` widget.
- **Tasks:**
  - The briefing card scrolls with the list (at 200% text it pushed the tasks off screen). Its header wraps.
  - Day chips grow with the font and are buttons with a selected state.
  - Weekday names and task subtitles follow the app language (de/es/fr/tr saw English, and everyone saw raw values such as `todo · none · Due …`).
  - The swipe background follows RTL, tasks have a spoken delete action, and the close button has a tooltip.
- **Focus timer:**
  - It scrolls instead of cutting off its controls.
  - The dial grows with the font, and the countdown stays inside the ring.
  - Labels use accessible colours, and the clear-song button keeps its 48 dp target.
  - Each task row is one semantics node: title, checkbox, long-press select and the delete action are announced together.
  - The task picker fills the width. It used to size itself to the longest task title and overflowed the screen even at 100% text.
  - The native audio player is created on first use.
- 9 strings in six languages.
- Test: `test/g7_core_screens_test.dart` (Arabic, 200% text, 320×640).

**B1 — ADR-047** in `docs/architecture/design-decisions.md`
- Opaque, hashed refresh tokens. Ownership comes from the authenticated session.
- ADR-041 is unchanged. The API returns metadata only.

**B2 — backend** (`3f2364f`)
- `GET /api/v1/sessions` and `POST /api/v1/sessions/{id}/revoke`:
  - Current password first, using the shared, fail-closed re-authentication budget.
  - One transaction: the session row is locked and marked `user_revoked`, its refresh tokens are revoked, and its push devices are deleted.
  - Another account's id answers 404, and repeating a revoke changes nothing.
  - 30/60 s per user on both routes. Responses are `no-store`, and the audit event is `auth.session.revoke`.
- Forward-only migration `1792770000000_auth_sessions_user_revoked`, plus owner SQL `docs/auth/sql/auth-sessions-user-revoked.sql` (byte-identical, checked by a unit test).
  - Before the SQL runs, the revoke stores `logout` (savepoint fallback).
- OpenAPI regenerated. Guide: `docs/auth/signed-in-devices.md`.

**B3 — app** (`54e058a`)
- Profile → Signed-in devices:
  - This device is marked; other devices show their last activity.
  - Each device has a sign-out button with confirmation and the password dialog.
  - Loading, empty, truncated and error states, and messages for a wrong password, too many attempts and a device already signed out.
- Signing out this device runs the normal sign-out, which clears local data, widget data and reminders.
- The tile is hidden in the deletion grace period.
- Login no longer sends the fixed "Arena Mobile Client" device name.
- 22 strings in six languages.

**CI toolchain — Flutter pinned to 3.47.9** (`97cbbdc`)
- All four `subosito/flutter-action` steps in `.github/workflows/ci.yml` and `isolated-runtime.yml` now pin 3.47.9.
- The secret-triage provenance chain records the new `ci.yml` fingerprint.
- The reason is documented in `docs/mobile/flutter-integration.md`.

**B4 — tests**
- **Unit** `sessions.test.ts` (16): validation; the service (password first, 404, audit without the password); repository SQL and transaction steps; the `logout` fallback and its 10-minute memory; owner-SQL identity; snapshots.
- **Integration** `sessions-flow.test.ts` (10):
  - Metadata only and no caching; another device's refresh, access token and push device stop working.
  - IDOR returns 404 and changes nothing; a wrong password is rejected, and malformed bodies spend no budget.
  - Revoking is idempotent and works on an expired session; signing out this device behaves like logout.
  - A revoke racing a refresh, 3 rounds, leaves no working token.
  - The ADR-041 reuse path still records `reuse_detected`.
  - Export and account deletion still work.
  - Rate limits apply on both routes.
  - The stored `created_ip` appears in no response of the test.
- **Restricted-role rehearsal:** the owner SQL runs twice on a production-like schema with the runtime role. Before the SQL the revoke stores `logout`; after it, `user_revoked`.
- **App:** `signed_in_devices_screen_test.dart` and the Profile tests.

## 4. Evidence

Hosted CI: CI Pipeline / isolated backend runtime / source secret detection.

| Commit | What | Runs | Result |
|---|---|---|---|
| `f4fe7f2` (main) | baseline after PR #30 | 43071703795 | PASS |
| `f48826a` | Step 0 audit (docs) | none (branch push without PR) | NOT RUN |
| `88967f0` | A1 | 43078622352 / 43078622325 / 43078622301 | PASS |
| `4100fca` | A3 + P1-F15 | 43079845192 / 43079845236 / 43079845157 | FAIL (Dart format only) |
| `e73a36b` | format patch from CI | 43081057365 / 43081057173 / 43081056807 | PASS |
| `3f2364f` | G6 backend | 43082880321 / 43082880338 / 43082880489 | PASS |
| `6e34cbb` | A2 | 43085297479 / 43085297617 / 43085297439 | FAIL (Dart compile error in the task tile; backend jobs passed) |
| `54e058a` | G6 app + A2 compile fix | 43086466551 / 43086466474 / 43086466385 | FAIL (CI picked up Flutter 3.50.0 and its analyzer failed in 68 files; plus two harness bugs in the new device-screen tests and a test needing `API_BASE_URL`) |
| `6abe9a0` | test-harness fixes, docs | 43087619845 / 43087620036 / 43087619865 | FAIL (Flutter 3.50 analyzer; the focus timer's task picker overflowed — a real bug — and the Tasks test asserted before scrolling); device-screen tests passed |
| `97cbbdc` | Flutter pinned to 3.47.9 | 43088050853 / 43088050773 / 43088050779 | FAIL — the pin works: the analyzer dropped from 90 infos in 68 files to 2, both `containsSemantics` in the new G7 test. The task-picker overflow and the Tasks test order remained. |
| `5bb67d2` | task picker fix, Tasks test order | 43088212912 / 43088212739 / 43088213008 | FAIL — the focus-timer G7 test and all device-screen tests passed. Still failing: the 2 `containsSemantics` infos, and two date-strip cells off the 320 dp test screen |
| `7f229da` | `isSemantics`; tests scroll the date strip | 43089201292 / 43089201187 / 43089201170 | FAIL — static analysis passed. One Flutter test failed: the guideline check found an unlabelled semantics node on each task row (A2-F4, a real G7 gap) |
| `ad5d909` | one semantics node per task row | 43090016533 / 43090016535 / 43090016572 | **PASS** — all three workflows: Flutter analyze/test and Android debug build on the pinned 3.47.9, backend gate, SDK fixture, isolated runtime, secret detection. The signed build job is skipped by design. |

The commit that adds these final rows changes docs only; its own run is cited in the
PR #31 description.

Hosted CI job summaries are not readable through the API from this sandbox, so per-test
counts on hosted CI are not quoted. A PASS means the job (unit, integration and security
tests, restricted-role step, Flutter analyze/test, Android debug build) concluded
successfully on that commit.

**Local evidence** (executed in this sandbox on the commits named, not on hosted CI):
- **Backend unit:**
  - 55 files / 596 tests (`3f2364f`).
  - `zoned-date-time` 26/26 on the fix and 13 failures on the old code (`88967f0`).
- **Integration + security:** 39 files / 231 tests, 2 files skipped (they need CI-only env). Embedded PostgreSQL 16.15 + Redis 6.0.9; migrations run as `lifestyle_migrator`, tests as the runtime role `lifestyle_app` (`3f2364f`).
- **Restricted-role sequence:** passed on a second disposable instance (`3f2364f`).
- **Owner SQL rehearsal** through the API (local PostgreSQL, not production):
  - With the old constraint, the verification query gave `0, 1` and a revoke stored `logout`.
  - After running the file twice, it gave `1, 1` and a revoke stored `user_revoked`.
- **Gates:** prettier, eslint, tsc (src and tests), `openapi:check`, `check:forbidden`, 191 root tests, l10n gate, docs guard, secret scan — all passed.
- **Dart and Kotlin:** no local toolchain. Hosted CI only.

## 5. Files

- **Backend:**
  - `backend/src/core/time/{wall-clock,date-utils}.ts`, `backend/src/features/notifications/notification-policy.ts`.
  - `backend/src/features/sessions/*` (5 files), `backend/src/{app,container}.ts`, `backend/src/docs/openapi-generator.ts`.
  - Migration `1792770000000_auth_sessions_user_revoked.cjs`, `schema.sql`, `schema-sql.ts`.
  - Tests: `backend/tests/unit/{zoned-date-time,sessions}.test.ts`, `backend/tests/integration/{sessions-flow,restricted-role-sequence}.test.ts`.
- **Mobile:**
  - `lib/features/auth/presentation/{profile_screen,signed_in_devices_screen}.dart`, `lib/features/auth/data/{sessions_client,auth_repository}.dart`.
  - `lib/features/focus_shield/{focus_shield_models,focus_shield_provider}.dart`.
  - `lib/features/home/presentation/home_shell.dart`, `lib/features/tasks/presentation/tasks_screen.dart`.
  - `lib/features/timer/presentation/focus_timer_screen.dart`, `lib/features/timer/data/session_audio_player.dart`.
  - `lib/l10n/*` (43 new keys, 2 changed).
  - Tests: `test/{xp_ledger,g7_core_screens,signed_in_devices_screen}_test.dart`, `test/profile_controls_a11y_test.dart`.
- **Docs and gates:**
  - `docs/auth/signed-in-devices.md`, `docs/auth/sql/auth-sessions-user-revoked.sql`.
  - ADR-047, `docs/architecture/auth.md` §6, `docs/database/migrations.md`, `docs/api/openapi.yaml`.
  - `docs/mobile/manual-test-checklist.md` (G6-1..G6-5, G7-1..G7-3, P1-15, A3-1), `CHANGELOG.md`, `scripts/l10n-literal-baseline.json`.
- **CI:** `.github/workflows/{ci,isolated-runtime}.yml` (Flutter pin), `docs/mobile/flutter-integration.md`, `docs/remediation/secret-triage.json` (provenance follow-up).

## 6. Findings

| Id | Status | Finding |
|---|---|---|
| G2-F1 | Fixed | DST offset in `zonedDateTimeToUtc` (A1). |
| P1-F15 | Fixed | Invented rank-card numbers (A4). |
| P1-F16 | Fixed | Hard-coded Profile text (A3). |
| A1-F1 | Open, Low (new) | `getDayBoundsUtc` applies the noon offset to both ends of the day. On 23- or 25-hour days one bound is an hour off, for example Cairo 2026-10-29 ends at 20:59:59Z instead of 21:59:59Z (executed locally). Used by calendar day views. A SAFE fix reusing `localDayBounds` is ready to propose. |
| A2-F1 | Open, Low (new) | The Tasks briefing card shows its own level (completed tasks × 10 XP, a level every 50 XP). It differs from the Profile ledger level. Owner decision: align, relabel or remove. |
| G6-F1 | Open, owner decision (new) | The v1 archive file (`POST /users/me/export/archive`) contains the account's own `created_ip` values. This is the user's own data export, but the prompt's B4 says `created_ip` should appear in no response. The sessions API and the JSON export never return it. Keep it, or remove it with an archive version bump. |
| G6-F2 | Open, Low (new) | Device names: no plugin gives a real device name without a new dependency, so devices show their platform. The app version sent at login is a fixed "1.0.1" (matches `pubspec.yaml` today; will go stale). |
| CI-F1 | Mitigated (new) | Flutter 3.50.0 (stable since 2026-11-09) deprecates `package:flutter/material.dart` and the global localization delegates in favour of `material_ui`/`cupertino_ui`. CI used the floating `stable` channel, so `flutter analyze --fatal-infos` failed in 68 files on any branch, `main` included. Pinned to 3.47.9 (owner decision). Moving on needs that migration: a new dependency, so it needs owner approval. The 3.50 `pub get` also rewrote `pubspec.lock`; not applied. |
| A2-F3 | Open (new, Low) | The Tasks date strip opens three days back. In the CI tests (320 dp screen), tomorrow's cell at 100% and today's cell at 200% started off-screen; the user reaches them by scrolling the strip. Opening the strip scrolled to today is a design choice, so it is not changed here. |
| A2-F4 | Fixed (new) | Each task row had a second, unlabelled semantics node carrying the long-press select and the delete actions (`labeledTapTargetGuideline`). |
| A2-F2 | Fixed (new) | The focus timer's task picker overflowed the screen with long task titles, even at 100% text. |
| P0-F9, P0-F10, G2-F3 | Open | Unchanged from the earlier reports. |

## 7. Still NOT RUN

- **Device checklist:** P1-1..P1-12, G2-1..G2-9, G6-1..G6-5, G7-1..G7-3, P1-15, A3-1, on a real Android phone (two phones for G6).
- **Production SQL, run by the owner and not from here:** G2 (`docs/notifications/sql/notification-preferences.sql`) and G6 (`docs/auth/sql/auth-sessions-user-revoked.sql`) were applied on 2026-11-11 (owner-reported). This environment cannot check the database.
- **Signed release build** and store listing (Data safety, privacy policy).

## 8. Owner checklist — deployment order

1. **Done on 2026-11-11 (owner-reported): SQL first, on Neon.** G2 and G6 were rehearsed on a Neon branch of production, then applied to production. Verification returned the expected values:
   - G2: `t, t, t, t` and `0`.
   - G6: `1, 1` and `0`.
   - Never run `npm run migrate` on Neon.
2. **Then the backend (next):** merge PR #31 when satisfied. Merging deploys `main` to Railway automatically.
3. **Then the app:** publish only after steps 1 and 2. Re-run the onboarding backfill (`UPDATE users SET onboarding_completed_at = created_at WHERE onboarding_completed_at IS NULL;`) right before publishing.
4. **Device pass** with the checklist above, then the signed release (`android-signed-release` workflow on `main`).

## 9. Recommendation for the next decision

1. Merge PR #31 (the SQL it needs is applied), then publish the app and run the device pass. Nothing else moves the release verdict.
2. Decide G6-F1 (archive `created_ip`) and A2-F1 (briefing level).
3. Approve the A1-F1 fix (SAFE, small). Decide when to plan the `material_ui` migration that lifts the Flutter pin (CI-F1).
4. Next CAREFUL item: E3 server push. G2's policy gate and G6's per-device sign-out, which removes that device's push registration, are now both in place, so it is the logical next step. It needs an ADR and the Firebase approval (ADR-039).
