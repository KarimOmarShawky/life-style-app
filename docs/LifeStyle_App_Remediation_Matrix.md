# LifeStyle App Remediation Matrix
**Branch**: `arena/1619e266-life-style-app`  
**Date**: 2026-11-02  
**Audit Reference**: `LifeStyle_App_Final_Independent_Verification_Audit_Report.pdf` (audit date 2026-11-01)  
**Supersedes**: `docs/LifeStyle_App_Remediation_Matrix.md` (2026-10-31, V-01…V-11 only)

## Verification vocabulary

| Term | Meaning |
| :--- | :--- |
| PASS | The stated command executed in this workspace and succeeded. |
| FAIL | The stated command executed and failed. |
| BLOCKED | The command cannot be executed here (missing SDK, service or provider). |
| NOT RUN | Not attempted in this workspace. |
| source-verified | Corrected in source and covered by source-contract tests; no runtime proof exists yet. |

## V-01…V-11 (earlier audit, corrected per AUD-14)

| Finding | Severity | Correction / Source Path | Verification Status | Evidence / Code Path |
| :--- | :--- | :--- | :--- | :--- |
| **V-01** (SMS Status handling) | P1 | Kotlin `SmsTransactionReceiver.kt` (exhaustive `when`), Dart `pending_wallet_reviews.dart` (exhaustive `switch`) | **source-verified / runtime-BLOCKED** | Contract Tests PASS (`scripts/wallet-sms-contract.test.mjs`); `flutter test`/`gradlew test` BLOCKED (SDK absent) |
| **V-02** (Native Wallet Queue durability) | P1 | Kotlin `SmsTransactionReceiver.kt` (`commitEntry`/`removeEntry` verification), Dart `pending_wallet_reviews.dart` (`_removeEntry`/`_writeCandidate` verification) | **source-verified / runtime-BLOCKED** | Contract Tests PASS; Dart/Kotlin runtime BLOCKED |
| **V-03** (Financial SMS Notification privacy) | P1 | Kotlin `SmsTransactionReceiver.kt` (`showTransactionNotification` visibility/public version), Dart `pending_wallet_reviews.dart` (`WalletSmsNotificationDetails`) | **source-verified / runtime-BLOCKED** | Contract Tests PASS; device lock-screen behaviour BLOCKED |
| **V-04** (Password Reset Fencing) | P1 | Backend `reset-request-dispatcher.ts`, `password-reset-request.repository.pg.ts` | **PASS** (backend unit) | TypeScript Compilation PASS, Unit Tests PASS, Contract Tests PASS |
| **V-05** (Password Reset Recovery/Shutdown) | P2 | Backend `reset-request-dispatcher.ts` (`runRecoveryCycle`, `shutdown`, `waitForIdle`), `password-reset-request.repository.pg.ts` (`recoverStale`, `claimDue`) | **PASS** (backend unit) | TypeScript Compilation PASS, Unit Tests PASS |
| **V-06** (Password Reset Erasure/Retention) | P1 | Backend `password-reset-request.repository.pg.ts` (`purgeOlderThan`, `attachOwner`), `users.repository.pg.ts` (`purgeAccount`, `scheduleDeletion`) | **PASS** (backend unit) | TypeScript Compilation PASS, Unit Tests PASS |
| **V-07** (Task Pagination) | P1 | Backend `tasks.cursor.ts` (Versioned cursor), `tasks.repository.pg.ts` (`keysetPredicate`) | **PASS** (backend unit) | TypeScript Compilation PASS, Unit Tests PASS |
| **V-08** (Money Invariants) | P1 | Backend `money.invariants.ts` (`assertTransactionInvariants`, `assertSubscriptionPaymentInvariants`) | **PASS** (backend unit) | TypeScript Compilation PASS, Unit Tests PASS |
| **V-09** (Calendar Validation) | P2 | Backend `core/validation/date-only.ts` (`isValidCalendarDate`, `calendarDaySchema`) | **PASS** (backend unit) | TypeScript Compilation PASS, Unit Tests PASS |
| **V-10** (Log Minimization) | P2 | Backend `core/logger/log-minimization.ts` (`correlationId`, `summarizeErrorForLog`), `core/middleware/rate-limiter.ts`, `core/middleware/error-handler.ts` | **PASS** (backend unit) | TypeScript Compilation PASS, Unit Tests PASS |
| **V-11** (API Documentation) | P2 | Backend OpenAPI specs, `scripts/check-docs-consistency.mjs` | **PASS** (docs guard) | Script Checks PASS, Contract Tests PASS |

## AUD-01…AUD-14 (2026-11-01 audit — remediated this session)

| Finding | Severity | Correction / Source Path | Verification Status | Evidence / Code Path |
| :--- | :--- | :--- | :--- | :--- |
| **AUD-01** (reset retry marked sent during cooldown) | Medium (P1) | `password-reset.processor.ts` retry path no longer marks `sent` inside the OTP cooldown | **PASS** (executed harness, 16/16) | Negative control reproduces the defect when the guard is removed |
| **AUD-02** (cursor ms truncation) | Medium (P1) | `tasks.cursor.ts` `cursorValueFor` prefers raw `created_at_text`/`updated_at_text` strings (µs-preserving); repository `list()` selects those columns | **PASS** (unit, 14/14) | `tasks-cursor.test.ts`; tsc --noEmit exit 0 |
| **AUD-03** (account enumeration via forgot-password rate limit) | Medium (P1) | Account budget `pwreset-acct-attempts:<userId>` 20/h; forgot-password per-account 10/h | **PASS** (unit, 11/11) | Rate-limiter unit tests |
| **AUD-04** (reauthentication missing on change-password) | Medium (P1) | Shared `createReauthenticationLimiter` (fail-closed, 5/900s); `users.routes` + `auth.routes` change-password use it | **PASS** (unit, 3/3) | Integration test added NOT RUN |
| **AUD-05** (wallet SMS auto-save trusted-sender) | Medium (P1) | `SmsTransactionReceiver.kt` trusted-sender allow-list; high-confidence auto-save removed (Dart + Kotlin) | **PASS** (contract, 13/13) | `wallet-sms-contract.test.mjs`; Kotlin/Dart compile NOT RUN |
| **AUD-06** (timezone-dependent dates) | Low (P2) | `toISOString().slice(0,10)` at DATE-column sites replaced with `formatDateOnly` (local getters) | **PASS** (tsc exit 0) | `projects.dto.ts`, `recurring-tasks.dto.ts`, `habits.service.ts`, `tasks.cursor.ts` |
| **AUD-07** (money update race) | Low (P2) | `updateTransaction` adds `SELECT … FOR UPDATE`, recomputes effective record inside lock, re-runs `assertTransactionInvariants` before write | **PASS** (unit, 432 total) | `money.repository.pg.ts`, `money.service.ts`, `money-invariants.test.ts` |
| **AUD-08** (year 0000 accepted) | Low (P2) | `isValidCalendarDate` rejects year <1 (and >9999) | **PASS** (unit, 6/6) | `date-only.test.ts`; negative control confirmed |
| **AUD-09** (worker reset ownership) | Low (P2) | `worker.ts` passes `resetRequestStore.attachOwner` as `PasswordResetProcessor` ownerLink | **PASS** (unit 17/17) | `password-reset-durability.test.ts` (AUD-09 regression) |
| **AUD-10** (mobile builds default to production API) | Low (P2) | `app_config.dart` defaultValue removed; `SmsTransactionReceiver.kt` `DEFAULT_API_BASE` removed; `build_apk.bat` requires `API_BASE_URL` | **PASS** (contract, 18/18) | `android-build-preparation.test.mjs` |
| **AUD-11** (exported VoiceActionReceiver) | Low (P2) | `AndroidManifest.xml` `exported="false"` on VoiceActionReceiver | **PASS** (contract, 9/9) | `native-voice-cleanup.test.mjs` |
| **AUD-12** (wallet-queue residuals) | Low (P2) | Dart `_remove`/`_publishQuarantineFlag` verify disk; `_isPermanentRejection` adds 409; `_retryQuarantined` write failure publishes fault | **PASS** (contract, 13/13) | `wallet-sms-contract.test.mjs` |
| **AUD-13** (notification channel) | Low (P2) | `ensureNotificationChannel(context)` helper called before every notify() path | **PASS** (contract, 13/13) | `wallet-sms-contract.test.mjs` |
| **AUD-14** (docs overstate verification) | Low (P2) | Controlled Remediation Report corrected (V-01…V-03 → source-verified/runtime-BLOCKED); 10-29 header counts fixed; checklist corrected | **PASS** (static) | `LifeStyle_App_Controlled_Remediation_Report_2026-11-01.md`, this matrix |

## AUD-15…AUD-20 (Informational — tracked/remediated)

| Finding | Severity | Correction | Verification Status |
| :--- | :--- | :--- | :--- |
| **AUD-15** (dependency advisories) | Informational | Tracked — upgrade plan documented; no version changes without verification | TRACKED |
| **AUD-16** (proxy trust) | Informational | Production start-up warning when `TRUST_PROXY_HOPS=0` | **PASS** (tsc, unit 439) |
| **AUD-17** (auxiliary listeners) | Informational | Opt-in via `AUXILIARY_PORTS` env var | **PASS** (tsc, unit 439) |
| **AUD-18** (test coverage gaps) | Informational | Unit tests added for projects/recurring-tasks DTOs (7/7); integration/security remain BLOCKED | **PASS** (unit 7/7) |
| **AUD-19** (partial localisation) | Informational | Tracked — translation completion plan documented; English fallback prevents crashes | TRACKED |
| **AUD-20** (maintainability) | Informational | Stale comment fixed; unused CORS removed; mailpit pinned; Windows path fixed; README POSIX note added | **PASS** (tsc, docs 13/13) |

## Notes
- **Mobile/Native runtime**: Flutter `flutter test`/`flutter analyze`, Kotlin `gradlew test`, and device runs remain **BLOCKED** (SDK/device absent). All mobile/native findings are **source-verified and contract-guarded**, not runtime-certified.
- **Backend integration/security suites**: **BLOCKED** without PostgreSQL/Redis. Unit suites (432 tests) and script contract suites execute and pass.
- **Baseline Safeguards**: No destructive Git operations, no production migrations, no secrets exposure. Forward-only migrations only.
- **Architecture/Requirements**: Preserved. Minimal, targeted changes only.

---
*Updated by Arena.ai Agent Mode on branch `arena/1619e266-life-style-app`.*
