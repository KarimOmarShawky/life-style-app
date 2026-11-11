# Next step (G6, G7 widening, closure) — Step 0 audit, no code (2026-11-11)

> **Historical snapshot** — audit of `main` at `f4fe7f2` (PR #30 merged) on branch
> `arena/1cb3ca6e-life-style-app`, 2026-11-11. Line numbers refer to that commit.
> Nothing was changed in code. This is not a release approval.

Source prompt: `LifeStyle_Next_Step_Prompt_G6_and_Closure.pdf` (attached by the owner).

## 0. Facts that changed since the prompt was written

- **PR #30 is merged** (`f4fe7f2`, 2026-11-11 17:48 UTC). Railway deployed that commit to
  production automatically (GitHub deployment "intelligent-acceptance / production",
  status `success` at 17:49 UTC). The G2 backend is therefore already live.
- **G2 owner SQL on production: not confirmed.** Until it is applied, reading notification
  settings returns the defaults with `available: false` and saving answers 503
  (by design). The app version with the settings screen is not published, so no user
  can reach that path yet. Apply the SQL before publishing the app.
- **Hosted CI on this branch needs a pull request.** `ci.yml` runs on `push` only for `main`
  and an old branch, and `isolated-runtime.yml` only on `pull_request`
  (`.github/workflows/ci.yml:3-9`, `.github/workflows/isolated-runtime.yml:3-6`).

## 1. G2-F1 — DST offset bug in `zonedDateTimeToUtc`: **confirmed, open**

- `backend/src/core/time/date-utils.ts:116-156`. It builds `guess` from the wall clock read
  as UTC (line 125) and takes the offset at `guess` (lines 139-151), not at the target instant.
- Only caller: `backend/src/features/reminders/reminders.repository.pg.ts:198` (relative
  reminders anchored to a task's due date and time).
- Executed on `f4fe7f2` with `tsx` (no code change):

| Zone, local time | Returned | Correct | Result |
|---|---|---|---|
| Cairo 2026-04-23 23:30 (eve of spring forward) | 20:30Z | 21:30Z | WRONG |
| Cairo 2026-04-24 01:30 | 22:30Z | 22:30Z | OK |
| Cairo 2026-10-29 22:30 (eve of fall back) | 20:30Z | 19:30Z | WRONG |
| Berlin 2026-03-29 01:30 | 23:30Z (28th) | 00:30Z | WRONG |
| New York 2026-03-07 22:30 | 03:30Z | 03:30Z | OK |
| Cairo 2026-11-11 09:00 | 07:00Z | 07:00Z | OK |

Plan (A1): move the policy's wall-clock helpers to `backend/src/core/time/` (core must not
import from a feature), use them in `zonedDateTimeToUtc` with the policy's rules (a time in a
gap moves forward by the gap; a repeated time takes the first occurrence), and add tests in
Cairo, Berlin and New York. Existing stored reminders are not changed.

## 2. P1-F15 — invented numbers on Profile: **confirmed, open (owner decision)**

- The rank card shows fixed text and a fixed bar:
  - `lib/l10n/catalog_en.dart:204` `'levelXpBadge': 'Level 2 • 140 XP'`.
  - `lib/l10n/catalog_en.dart:205` `'xpRemainingText': '60 XP remaining to Level 3 (Pro)'`.
  - The other five catalogs translate the same numbers.
  - `lib/features/auth/presentation/profile_screen.dart:532-533` `LinearProgressIndicator(value: 0.7)`.
- The badges are fixed booleans: `profile_screen.dart:561-572` (two always earned, one never).
- **Real data exists on the device:**
  - The Focus Shield XP ledger (`lib/features/focus_shield/focus_shield_models.dart:80-82`: `totalXp`, `level = totalXp ~/ 200 + 1`, `rank`).
  - It is stored per account (`focus_shield_provider.dart:85`, key `focus_suite.v1.<userId>`).
  - The home widget already shows it (`home_widget_sync.dart:52-53`).
  - It is device-local, not synced across devices.

Options: wire the card to that ledger (and show only badges that can be computed from real
data), or remove the card and badges. No change until the owner decides.

## 3. G6 — sessions and devices: **gap confirmed (no endpoint, no screen)**

- Routes today: `backend/src/features/auth/auth.routes.ts:153-165` (register, login, refresh,
  logout, logout-all, forgot-password, reset-password, change-password). No list or single-session revoke.
- `auth_sessions` (`schema.sql:31-47`):
  - `id`, `user_id`, `created_at`, `last_used_at`, `absolute_expires_at`, `revoked_at`.
  - `revoked_reason`, with CHECK `IN ('logout', 'logout_all', 'password_change', 'password_reset', 'reuse_detected', 'account_disabled', 'account_deletion')` (lines 38-41).
  - `device_platform`, `device_name`, `app_version`, `created_ip INET`.
  - CHECK `(revoked_at IS NULL) = (revoked_reason IS NULL)`.
  - Revoking one device needs a new value (for example `user_revoked`).
- **Refresh tokens:**
  - `refresh_tokens.session_id` references `auth_sessions(id)` (`schema.sql:56-66`).
  - Refresh rejects any token whose session is revoked or expired (`auth.service.ts:315-321`).
  - Revoking a session therefore kills all of its refresh tokens, even though logout does not set `refresh_tokens.revoked_at`.
- **Access tokens:** every request re-validates the session (`core/middleware/authenticate.ts:59-62`,
  `core/security/session-validator.ts:36-60`: `revoked_at`, `absolute_expires_at`, user status),
  so a revoke takes effect on the next request.
- **Push devices:**
  - `push_devices.session_id` is `NOT NULL` and cascades from `auth_sessions` (`schema.sql:75-85`), so the link always exists.
  - Logout deletes that session's push devices (`auth.service.ts:476-477`).
  - Logout-all revokes every session (`logout_all`) and deletes every push device of the user (`auth.service.ts:507-516`).
  - Password change keeps only the current session (`auth.service.ts:668-669`).
- **ADR-041 reuse detection:**
  - Main path: `auth.service.ts:324-326`, `reuse_detected` plus push-device delete.
  - Rotation race: `auth.service.ts:383-384`.
- **Every query that reads or revokes sessions:**
  - `auth.repository.pg.ts:71` (create), `:113-125` (refresh lookup; it reads `created_ip` internally), `:190-219` (rotation and `last_used_at`), `:226-238` (`revokeSession`), `:240-258` (`revokeAllUserSessions`), `:283-301` (push-device deletes).
  - `users.repository.pg.ts:257-276` (deletion schedule revokes sessions and refresh tokens), `:342-346` (purge), `:427-429` (metadata export: no `created_ip`).
  - `jobs/job-stores.pg.ts:451-459` (expired-session purge).
- **`created_ip`:**
  - Returned by no API response today.
  - Present only in the user's own v1 archive file (`account-archive.sources.ts:16-21`, the user's data export).
  - The new list must never return it.
- **Re-authentication pattern to reuse:**
  - `currentPassword` in the body, checked by `UsersService.reauthenticate` (`users.service.ts:33-37`).
  - Behind the shared fail-closed limiter of 5 per 15 minutes per account (`core/middleware/reauthentication.ts:41`, used at `users.routes.ts:39-57`).

Plan (B, after approval):
- **ADR-047:** opaque hashed refresh tokens; ownership only from the authenticated session; ADR-041 unchanged; metadata only.
- **`GET /api/v1/sessions`:** active sessions, newest first, with id, platform, device name, app version, created, last used and `current`.
- **`POST /api/v1/sessions/{id}/revoke`:**
  - Requires `currentPassword` and the shared re-authentication limiter.
  - Another account's id answers 404. Repeating it changes nothing.
  - It revokes the session and that session's refresh tokens, and deletes that session's push devices, in one transaction.
- **Forward-only migration** adding `user_revoked`, plus owner SQL with verification queries.
  - Until that SQL runs, the revoke stores `logout` instead (the check would reject the new value).
- **Profile → "Signed-in devices":**
  - Marks this device.
  - A sign-out button per device, with confirmation and password.
  - Signing out this device equals logout (clears caches, widget data and reminders).
  - Strings in all six languages and a G7 test.
- **Tests:** IDOR, expired and revoked sessions, concurrent revoke and refresh, push cleanup, export and deletion unaffected, ADR-041 regression, and `created_ip` absent from every response.

## 4. G7 coverage gap — **confirmed**

- G7 widget tests exist only in `onboarding_test.dart`, `habit_card_test.dart`, `profile_controls_a11y_test.dart` and `notification_settings_screen_test.dart`.
- **No widget test** touches `HomeShell`, `TasksScreen` or `FocusTimerScreen` (no reference in `test/`).
- `lib/features/tasks/presentation/tasks_screen.dart`:
  - An `IconButton` without a tooltip at line 102.
  - Left/right-fixed spacing and alignment at lines 301 (`EdgeInsets.only`), 464 (`fromLTRB`), 472-473 and 602 (`Alignment.centerLeft/Right`).
  - A `GestureDetector` at 333 and an `InkWell` at 608 to check for labels and 48dp size.
- `lib/features/timer/presentation/focus_timer_screen.dart:435-460`: a fixed 240×240 circle holding 48 px and 16 px text. At 200% text the time (96 px) is likely to clip.
- `lib/features/home/presentation/home_shell.dart`: no fixed left/right or unlabeled icon buttons found by the scan. A widget test is still missing.
- Profile hard-coded text: `profile_screen.dart` holds 10 of the 95 frozen literals (`scripts/l10n-literal-baseline.json`), for example the account-deletion dialog (`profile_screen.dart:313-371`) and the AI assistant tile (`profile_screen.dart:612`). Four of six languages see English there.

Plan (A2, A3):
- Tooltips and labels, 48dp targets, directional padding and alignment.
- A scaling timer readout, and swipe actions that follow RTL.
- Widget tests at 200% Arabic text on a narrow screen, kept in CI.
- Localize the Profile literals in six languages and lower the baseline (never raise it).

## 5. Evidence status

- **Executed here:** source reads and the `tsx` demonstration in §1 (on `f4fe7f2`).
- **NOT RUN:**
  - The device checklist (P1-1..P1-12, G2-1..G2-9).
  - Production SQL state (G2) and the signed release.
- **Out of scope:** E3 push, E5, E7, streak grace, iOS, new SDKs.
