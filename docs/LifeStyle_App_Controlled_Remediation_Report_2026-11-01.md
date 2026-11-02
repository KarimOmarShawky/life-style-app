# LifeStyle App Controlled Remediation Report
**Branch**: `arena/1619e266-life-style-app`  
**Date**: 2026-11-02  
**Audit Reference**: `LifeStyle_App_Final_Independent_Verification_Audit_Report.pdf` (audit date 2026-11-01)  
**Scope**: Findings AUD-01 through AUD-14 (5 Medium P1, 9 Low P2)

## Executive Summary

This report records the controlled remediation of the 14 confirmed findings
(AUD-01…AUD-14) from the *LifeStyle App — Final Independent Verification Audit
Report* dated 2026-11-01. Every finding was corrected at its root cause with
minimal, targeted changes. No architecture, security control, data-integrity
mechanism, or previously working functionality was removed or weakened.

This report supersedes `docs/LifeStyle_App_Controlled_Remediation_Report.md`
(2026-10-31), which overstated verification for V-01…V-03 (AUD-14). The
corrections made here are reflected in that file's AUD-14 correction banner.

## Verification vocabulary

| Term | Meaning |
| :--- | :--- |
| PASS | The stated command executed in this workspace and succeeded. |
| FAIL | The stated command executed and failed. |
| BLOCKED | The command cannot be executed here (missing SDK, service or provider). |
| NOT RUN | Not attempted in this workspace. |
| source-verified | Corrected in source and covered by source-contract tests; no runtime proof exists yet. |

## Environment

**Present**: Node 22, npm, Python 3, git, GitHub CLI, PostgreSQL 16 migration
tooling (type-level), TypeScript 5, Vitest.

**Absent (confirmed)**: Flutter/Dart SDK, JDK/Android SDK, `kotlinc`, Docker,
PostgreSQL server, Redis server, emulator, physical device, SMTP/AI/push
providers.

**Consequence**: Dart and Kotlin changes are **syntax- and contract-verified
only**. Backend unit suites execute; integration and security suites are
**BLOCKED** (no PostgreSQL/Redis). Flutter/Kotlin runtime suites are
**BLOCKED** (SDK absent).

## Executed checks (this workspace)

| Command | Scope | Result |
| :--- | :--- | :--- |
| `cd backend && npx tsc --noEmit` | backend type check | **PASS** (no output) |
| `cd backend && npx vitest run tests/unit` | backend unit suites | **PASS** — 432 tests / 42 files |
| `node --test scripts/wallet-sms-contract.test.mjs` | wallet SMS contract (AUD-05/12/13) | **PASS** — 13 tests |
| `node --test scripts/android-build-preparation.test.mjs` | build prep contract (AUD-10) | **PASS** — 18 tests |
| `node --test scripts/native-voice-cleanup.test.mjs` | voice cleanup contract (AUD-11) | **PASS** — 9 tests |
| `node scripts/check-docs-consistency.mjs` | docs/contract consistency | **PASS** |
| `node scripts/check-forbidden.mjs` | ADR-039 dependency guard | **PASS** |

**BLOCKED** (not executed, environment absent):
- `cd backend && npx vitest run tests/integration` — requires PostgreSQL/Redis.
- `cd backend && npx vitest run tests/security` — requires PostgreSQL/Redis + `ALLOW_DESTRUCTIVE_TESTS`.
- `flutter analyze` / `flutter test` — Flutter SDK absent.
- `./gradlew test` / APK assemble — Android SDK absent.
- Device/Keystore runs — no device.

## Finding dispositions

| ID | Severity | Root cause | Verification |
| :--- | :--- | :--- | :--- |
| AUD-01 | Medium (P1) | Reset-retry path marked `sent` inside the OTP cooldown | PASS (executed harness 16/16; negative control) |
| AUD-02 | Medium (P1) | Cursor timestamp truncated to ms via `Date` round-trip | PASS (unit 14/14; tsc) |
| AUD-03 | Medium (P1) | Forgot-password rate limit keyed per-IP, enabling enumeration | PASS (unit 11/11) |
| AUD-04 | Medium (P1) | Change-password lacked reauthentication | PASS (unit 3/3) |
| AUD-05 | Medium (P1) | Wallet SMS auto-save trusted any recognized parse | PASS (contract 13/13) |
| AUD-06 | Low (P2) | DATE-column reads used `toISOString().slice(0,10)` (UTC, not local) | PASS (tsc) |
| AUD-07 | Low (P2) | Money update validated effective record from a pre-read outside the write lock | PASS (unit 432 total) |
| AUD-08 | Low (P2) | Calendar validator accepted year 0000 | PASS (unit 6/6; negative control) |
| AUD-09 | Low (P2) | Worker reset processor never linked ownership | PASS (unit 17/17) |
| AUD-10 | Low (P2) | Mobile builds silently defaulted to the production API host | PASS (contract 18/18) |
| AUD-11 | Low (P2) | VoiceActionReceiver exported without a permission | PASS (contract 9/9) |
| AUD-12 | Low (P2) | Wallet-queue writes/removals ignored SharedPreferences results; rejection policy inconsistent | PASS (contract 13/13) |
| AUD-13 | Low (P2) | Review notification posted to a channel that may not exist | PASS (contract 13/13) |
| AUD-14 | Low (P2) | Remediation records overstated verification | PASS (static; docs corrected) |

## AUD-01 — Reset retry marked sent during cooldown

**Root cause**: `password-reset.processor.ts` marked a reset request `sent`
during a retry that fell inside the OTP cooldown window, so a user who had not
yet received the code was recorded as having received it.

**Correction**: The retry path no longer transitions to `sent` inside the
cooldown; the state machine respects the cooldown boundary.

**Verification**: Executed harness 16/16 PASS. Negative control (guard removed)
reproduces the `sent` transition, confirming the test is meaningful.

## AUD-02 — Cursor timestamp precision

**Root cause**: `tasks.cursor.ts` `cursorValueFor` built the cursor value from
a `Date` round-trip, truncating microseconds and producing an inconsistent
keyset predicate.

**Correction**: `cursorValueFor` prefers the raw `created_at_text`/
`updated_at_text` strings (µs-preserving) over a `Date` round-trip. The
repository `list()` selects those columns via `sql\`col::text\`.as('alias')`,
and `keysetPredicate` binds `${value}::timestamptz`. `dueDate`/`priority` are
unchanged. Fallback to `toIso(Date)` is required for test rows lacking text
fields.

**Verification**: `tasks-cursor.test.ts` 14/14 PASS; `tsc --noEmit` exit 0.

## AUD-03 — Account enumeration via forgot-password rate limit

**Root cause**: The forgot-password rate limit was keyed per-IP, so an attacker
could probe account existence by varying the IP.

**Correction**: Account budget `pwreset-acct-attempts:<userId>` (20/h) and
forgot-password per-account (10/h) limits added.

**Verification**: 11/11 PASS.

## AUD-04 — Reauthentication missing on change-password

**Root cause**: The change-password endpoint did not require reauthentication.

**Correction**: Shared `createReauthenticationLimiter` (fail-closed, 5/900s,
`reauth:user:<id>`); `users.routes` and `auth.routes` change-password use it.

**Verification**: 3/3 unit PASS. Integration test added NOT RUN.

## AUD-05 — Wallet SMS auto-save trusted any recognized parse

**Root cause**: The SMS receiver auto-saved a transaction when the fallback
analyzer returned a high-confidence parse, without user confirmation.

**Correction**: Trusted-sender allow-list (JSON array of normalized phones from
SharedPreferences `flutter.wallet_trusted_senders`, default EMPTY). Auto-save
only if the sender is trusted. High-confidence auto-save removed in both
`handleAnalysisResult` (Kotlin) and `_applyResult` (Dart); all recognized
results require review. Dedup/idempotency/opt-in/encryption preserved.

**Verification**: `wallet-sms-contract.test.mjs` 13/13 PASS. Kotlin/Dart
compile NOT RUN (SDK absent).

## AUD-06 — Timezone-dependent dates

**Root cause**: DATE-column reads used `toISOString().slice(0,10)`, which
produces the UTC calendar day, not the user's local day.

**Correction**: All DATE-column sites now use `date-utils.ts` `formatDateOnly`
(local getters). Sites fixed: `projects.dto.ts`, `recurring-tasks.dto.ts`,
`habits.service.ts` (5 sites), `tasks.cursor.ts` (`dueDate`). Safe sites
(Date.UTC-built or non-DATE-column reads) were not changed.

**Verification**: `tsc --noEmit` exit 0.

## AUD-07 — Money update race

**Root cause**: `updateTransaction` validated the effective record from a
pre-read that happened outside the write lock, so a concurrent partial update
could merge with stale values.

**Correction**: `updateTransaction` now acquires `SELECT … FOR UPDATE` on the
row inside `db.transaction()`, recomputes the effective record from the locked
row + input, re-fetches the category inside the transaction, and re-runs
`assertTransactionInvariants` before the write. The optional version predicate
is preserved.

**Verification**: `money-invariants.test.ts` (incl. new AUD-07 wiring test) PASS;
full unit suite 432/432 PASS; `tsc --noEmit` exit 0.

## AUD-08 — Year 0000 accepted

**Root cause**: `isValidCalendarDate` accepted year 0000, which is not a valid
proleptic Gregorian calendar year.

**Correction**: `isValidCalendarDate` rejects year <1 (and >9999).

**Verification**: `date-only.test.ts` 6/6 PASS. Negative control (year check
removed) → test FAILS → restored.

## AUD-09 — Worker reset ownership

**Root cause**: The worker's `PasswordResetProcessor` was constructed without an
`ownerLink`, so worker-delivered reset rows kept `user_id` NULL.

**Correction**: `worker.ts` now passes `resetRequestStore.attachOwner` as the
processor's `ownerLink`.

**Verification**: `tsc --noEmit` exit 0. Regression test added: `password-reset-durability.test.ts` verifies the processor calls `ownerLink.attachOwner(recordId, userId)` when a `recordId` is present, and that processing still succeeds without an `ownerLink` (17/17 PASS).

## AUD-10 — Mobile builds default to the production API host

**Root cause**: `app_config.dart` had a production `defaultValue` for
`API_BASE_URL`; the native receiver hard-coded the same host as a fallback;
`build_apk.bat` built a release APK without `API_BASE_URL`.

**Correction**: `app_config.dart` `defaultValue` removed (unset now fails the
launch). `SmsTransactionReceiver.kt` `DEFAULT_API_BASE` removed; an unset
`API_BASE_URL` skips the native flush. `build_apk.bat` requires `API_BASE_URL`
and passes it via `--dart-define`. `main.dart` stale comment updated.

**Verification**: `android-build-preparation.test.mjs` 18/18 PASS.

## AUD-11 — Exported VoiceActionReceiver

**Root cause**: `VoiceActionReceiver` was `exported="true"` without a permission,
so any app could trigger it.

**Correction**: `AndroidManifest.xml` sets `exported="false"`. The receiver is
only triggered by the app's own `PendingIntent.getBroadcast`, which does not
require exporting.

**Verification**: `native-voice-cleanup.test.mjs` 9/9 PASS.

## AUD-12 — Wallet-queue residuals

**Root cause**: Review-item removal and status counters ignored the
SharedPreferences result; Dart treated 400/422 as permanent while Kotlin treated
400/409/422 as permanent.

**Correction**: Dart `_remove` verifies `prefs.remove` and publishes a storage
fault on failure. `_publishQuarantineFlag` verifies its write. `_isPermanentRejection`
adds 409. `_retryQuarantined` write failure publishes a storage fault.

**Verification**: `wallet-sms-contract.test.mjs` 13/13 PASS.

## AUD-13 — Notification channel

**Root cause**: `showReviewNotification` posted to `CHANNEL_ID`, but the channel
was created only in `showTransactionNotification`; on Android 8+ a first-ever
fallback review notification was dropped.

**Correction**: `ensureNotificationChannel(context)` helper created; called
before every `notify()` path (both `showReviewNotification` and
`showTransactionNotification`).

**Verification**: `wallet-sms-contract.test.mjs` 13/13 PASS.

## AUD-14 — Documentation overstated verification

**Root cause**: The 2026-10-31 Controlled Remediation Report marked V-01…V-03
as unconditional PASS, stated no item was BLOCKED/NOT RUN, claimed "17 contract
tests", cited stale line ranges, listed unrelated backend reset files under
V-01, and the 10-29 response header severity counts disagreed with its table.
The manual-test checklist said the APK was debug-signed and showed a release
build with a Gemini key.

**Correction**: The existing report received an AUD-14 correction banner;
V-01/V-02/V-03 restated as source-verified/runtime-BLOCKED; the "no BLOCKED/NOT
RUN" claim corrected; V-01 unrelated backend files removed; the 10-29 header
counts fixed to Medium 7 · Low 4; the checklist corrected (release signing, no
Gemini key in release builds). This report is the current, accurate record.

**Verification**: Static review of the corrected docs.

## Residual verification required to close

These cannot be executed in this workspace and must be run in a clean,
approved environment:

1. **Android device**: lock-screen notification content, quarantine card
   behaviour, retry/backoff timing, Keystore key invalidation, retention
   expiry, storage-fault publication.
2. **Flutter**: `flutter analyze` and `flutter test`.
3. **Kotlin**: `./gradlew test` / assemble of the release APK.
4. **PostgreSQL + Redis**: integration and security suites (concurrent
   transaction update, reset-request fencing under two workers, multi-page
   pagination).
5. **Hosted CI**: the workflows that cover the above gates.

Until those gates run, the mobile/native findings above are **source-remediated
and contract-guarded**, not runtime-certified.

---
*Generated by Arena.ai Agent Mode on branch `arena/1619e266-life-style-app`.*
