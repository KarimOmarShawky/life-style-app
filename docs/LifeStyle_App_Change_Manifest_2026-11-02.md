# LifeStyle App Change Manifest — AUD-01…AUD-14 Remediation
**Branch**: `arena/1619e266-life-style-app`  
**Date**: 2026-11-02  
**Base commit**: `d45693e91df3777d2ebec81ef5a46cf53a5aa52c` (main)

## Summary

33 files changed (modified + new), 851 insertions, 186 deletions. All changes are
minimal, targeted root-cause fixes. No architecture, security control,
data-integrity mechanism, or previously working functionality was removed or
weakened. No new dependencies. No migration history changes.

## Backend — AUD-01 (reset retry cooldown)

| File | Change |
| :--- | :--- |
| `backend/src/features/auth/password-reset.processor.ts` | Retry path no longer marks `sent` inside the OTP cooldown |
| `backend/tests/unit/otp-service.test.ts` | Regression tests for cooldown boundary |
| `backend/tests/unit/password-reset-durability.test.ts` | Regression tests for retry/cooldown state machine |

## Backend — AUD-02 (cursor precision)

| File | Change |
| :--- | :--- |
| `backend/src/features/tasks/tasks.cursor.ts` | `cursorValueFor` prefers raw `created_at_text`/`updated_at_text` strings (µs-preserving) |
| `backend/src/features/tasks/tasks.repository.pg.ts` | `list()` selects text columns via `sql\`col::text\`.as('alias')`; `keysetPredicate` binds `${value}::timestamptz` |
| `backend/tests/unit/tasks-cursor.test.ts` | Regression tests for µs-preserving cursor |

## Backend — AUD-03 (account enumeration)

| File | Change |
| :--- | :--- |
| `backend/src/core/security/otp-service.ts` | Account budget `pwreset-acct-attempts:<userId>` 20/h |
| `backend/src/core/security/reset-request-dispatcher.ts` | Forgot-password per-account 10/h limit |
| `backend/tests/unit/otp-service.test.ts` | Rate-limit regression tests |

## Backend — AUD-04 (reauthentication)

| File | Change |
| :--- | :--- |
| `backend/src/core/middleware/reauthentication.ts` | **NEW** — shared `createReauthenticationLimiter` (fail-closed, 5/900s) |
| `backend/src/features/users/users.routes.ts` | Change-password uses the limiter |
| `backend/src/features/auth/auth.routes.ts` | Change-password uses the limiter |
| `backend/tests/unit/reauthentication-limiter.test.ts` | **NEW** — unit tests (3/3) |
| `backend/tests/integration/auth-flow.test.ts` | Integration test added (NOT RUN) |

## Mobile/Native — AUD-05 (trusted-sender auto-save)

| File | Change |
| :--- | :--- |
| `mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/SmsTransactionReceiver.kt` | Trusted-sender allow-list; high-confidence auto-save removed |
| `mobile-app/mobile/lib/features/money/data/pending_wallet_reviews.dart` | High-confidence auto-save removed in `_applyResult` |
| `scripts/wallet-sms-contract.test.mjs` | AUD-05 contract assertions |

## Backend — AUD-06 (timezone-dependent dates)

| File | Change |
| :--- | :--- |
| `backend/src/features/projects/projects.dto.ts` | Local `formatDateOnly` removed; imported shared |
| `backend/src/features/recurring-tasks/recurring-tasks.dto.ts` | Local `formatDateOnly` removed; imported shared |
| `backend/src/features/habits/habits.service.ts` | 5 DATE-column sites → `formatDateOnly` |
| `backend/src/features/tasks/tasks.cursor.ts` | `dueDate` case → `formatDateOnly` |

## Backend — AUD-07 (money update race)

| File | Change |
| :--- | :--- |
| `backend/src/features/money/money.repository.pg.ts` | `SELECT … FOR UPDATE` + recompute effective record inside lock + re-run `assertTransactionInvariants` |
| `backend/src/features/money/money.repository.ts` | Interface: added `userToday?` parameter |
| `backend/src/features/money/money.service.ts` | Passes `userToday` to repository |
| `backend/tests/unit/money-invariants.test.ts` | AUD-07 wiring regression test |

## Backend — AUD-08 (year 0000)

| File | Change |
| :--- | :--- |
| `backend/src/core/validation/date-only.ts` | `isValidCalendarDate` rejects year <1 (and >9999) |
| `backend/tests/unit/date-only.test.ts` | **NEW** — 6 regression tests (AUD-06/08) |

## Backend — AUD-09 (worker ownership)

| File | Change |
| :--- | :--- |
| `backend/src/worker.ts` | `resetProcessor` constructed with `ownerLink` → `resetRequestStore.attachOwner` |
| `backend/tests/unit/password-reset-durability.test.ts` | AUD-09 regression test (processor calls `attachOwner` when `recordId` present) |

## Mobile/Native — AUD-10 (production API default)

| File | Change |
| :--- | :--- |
| `mobile-app/mobile/lib/config/app_config.dart` | `defaultValue` removed from `API_BASE_URL` |
| `mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/SmsTransactionReceiver.kt` | `DEFAULT_API_BASE` removed; unset skips native flush |
| `build_apk.bat` | Requires `API_BASE_URL`; passes `--dart-define=API_BASE_URL` |
| `mobile-app/mobile/lib/main.dart` | Stale comment updated |
| `scripts/android-build-preparation.test.mjs` | AUD-10 contract assertions |

## Mobile/Native — AUD-11 (exported receiver)

| File | Change |
| :--- | :--- |
| `mobile-app/mobile/android/app/src/main/AndroidManifest.xml` | `VoiceActionReceiver` `exported="false"` |
| `scripts/native-voice-cleanup.test.mjs` | AUD-11 contract assertions |

## Mobile/Native — AUD-12 (wallet-queue residuals)

| File | Change |
| :--- | :--- |
| `mobile-app/mobile/lib/features/money/data/pending_wallet_reviews.dart` | `_remove` verifies disk; `_publishQuarantineFlag` verifies write; `_isPermanentRejection` adds 409; `_retryQuarantined` write failure publishes fault |
| `scripts/wallet-sms-contract.test.mjs` | AUD-12 contract assertions |

## Mobile/Native — AUD-13 (notification channel)

| File | Change |
| :--- | :--- |
| `mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/SmsTransactionReceiver.kt` | `ensureNotificationChannel(context)` helper; called before every `notify()` |
| `scripts/wallet-sms-contract.test.mjs` | AUD-13 contract assertions |

## Docs — AUD-14 (verification overstatement)

| File | Change |
| :--- | :--- |
| `docs/LifeStyle_App_Controlled_Remediation_Report.md` | AUD-14 correction banner; V-01/V-02/V-03 restated; "no BLOCKED/NOT RUN" corrected |
| `docs/LifeStyle_App_Remediation_Matrix.md` | Rewritten with AUD-14 corrections + AUD-01…AUD-14 rows |
| `docs/remediation/audit-response-2026-10-29.md` | Header severity counts fixed (Medium 7 · Low 4) |
| `docs/mobile/manual-test-checklist.md` | Debug-signing claim corrected; release-with-Gemini-key claim corrected |
| `docs/LifeStyle_App_Controlled_Remediation_Report_2026-11-01.md` | **NEW** — current accurate report |
| `docs/LifeStyle_App_Post_Remediation_Verification_Report_2026-11-01.md` | **NEW** — verification report |
| `docs/LifeStyle_App_Change_Manifest_2026-11-02.md` | **NEW** — this manifest |

## New files

| File | Purpose |
| :--- | :--- |
| `backend/src/core/middleware/reauthentication.ts` | AUD-04 shared limiter |
| `backend/tests/unit/date-only.test.ts` | AUD-06/08 regression tests |
| `backend/tests/unit/reauthentication-limiter.test.ts` | AUD-04 unit tests |
| `docs/LifeStyle_App_Controlled_Remediation_Report_2026-11-01.md` | AUD-14 deliverable |
| `docs/LifeStyle_App_Post_Remediation_Verification_Report_2026-11-01.md` | Verification deliverable |
| `docs/LifeStyle_App_Change_Manifest_2026-11-02.md` | This manifest |

---
*Generated by Arena.ai Agent Mode on branch `arena/1619e266-life-style-app`.*
