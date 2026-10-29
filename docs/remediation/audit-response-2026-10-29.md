# Audit response — Final Independent Verification Audit, 2026-10-29

Engineering response to the *LifeStyle App — Final Independent Verification
READ-ONLY AUDIT* (30 pages, dated 2026-10-29, snapshot
`life-style-app-main (5).zip`, 634 files) whose verdict was **NOT READY**
(Critical 0 · High 0 · Medium 6 · Low 5), with eleven confirmed findings
**V-01 … V-11**.

This is a remediation record, **not** a release certificate. Every entry below
states what changed in source, what was executed here, and what still requires a
clean environment (device, Flutter/Android SDK, PostgreSQL/Redis, providers).

## Verification vocabulary

The audit's vocabulary is reused; dispositions and verification outcomes are
kept separate.

| Term | Meaning here |
| :--- | :--- |
| PASS | The stated command executed in this workspace and succeeded. |
| FAIL | The stated command executed and failed. |
| BLOCKED | The command cannot be executed here at all (missing SDK, service or provider). |
| NOT RUN | Not attempted in this workspace. |
| code_unverified | Corrected in source and covered by source-contract tests; no runtime proof exists yet. |

## Environment used for this response

Present: Node 22, npm, Python 3, git, GitHub CLI, a scratch-installed WASM build
of `dart_style` (`@wasm-fmt/dart_fmt`) for syntax-only Dart parsing.

Absent (confirmed, not assumed): Flutter/Dart SDK, JDK/Android SDK, `kotlinc`,
Docker, PostgreSQL, Redis, emulator, physical device, SMTP/AI/push providers.

Consequence: Dart and Kotlin changes are **syntax- and contract-verified only**.
No `flutter test`, `flutter analyze`, `gradlew test`, APK or device run happened
in this workspace.

## Executed checks (this workspace, after the corrections)

| Command | Scope | Result |
| :--- | :--- | :--- |
| `cd backend && npx tsc --noEmit` | backend type check | **PASS** (no output) |
| `cd backend && npx vitest run tests/unit` | backend unit suites | **PASS** — 413 tests / 40 files |
| `node --test scripts/*.test.mjs` | repository contract/guard suites | **PASS** — 132 tests |
| `node scripts/check-docs-consistency.mjs` | docs/contract consistency (F-08, V-11) | **PASS** |
| `node scripts/check-forbidden.mjs` | ADR-039 dependency guard | **PASS** |
| WASM `dart_style` parse of every tracked `.dart` file | Dart syntax only | **PASS** — 138/138 parse (language 3.5.0) |
| Kotlin receiver | static review only (no `kotlinc`) | **BLOCKED** for compilation; brace/paren balance and import usage checked by script |

The audit's executed-check FAIL (`scripts/*.test.mjs` aborting on a missing
`js-yaml`) was **not** a source defect: the helper suites read the backend
dependency tree (`js-yaml` and the OpenAPI fixtures) from
`backend/node_modules`, which the read-only audit environment did not have. With
`npm ci` in `backend/`, the full helper suite runs green (132/132). No dependency
was added to the repository to work around it.

## Finding dispositions

| ID | Severity | Correction | Verification here |
| :--- | :--- | :--- | :--- |
| V-01 | Medium | Unknown/missing/non-string analyze statuses are retried, never `HANDLED`; the retry reason is explicit and the state is published | code_unverified (contract tests PASS, backend PASS) |
| V-02 | Medium | Durability: verified writes/removals, quarantine instead of deletion, transient-failure recovery, storage-fault publication | code_unverified (contract tests PASS) |
| V-03 | Medium | Notifications carry no SMS body, private visibility, redacted public version, amount/merchant behind an opt-in | code_unverified (contract tests PASS) |
| V-04 | Medium | Reset requests are fenced, leased and bounded across workers | PASS (backend unit) |
| V-05 | Low | Dispatcher outcome classification is exhaustive and observable | PASS (backend unit) |
| V-06 | Medium | Reset-request ownership, erase-on-delete and retention are enforced | PASS (backend unit) |
| V-07 | Medium | Task list cursor is versioned, sort-aware and matches ORDER BY including NULL placement | PASS (backend unit, SQL compiled) |
| V-08 | Medium | One effective-record invariant function for create, update and subscription payment | PASS (backend unit) |
| V-09 | Low | One semantic calendar-day parser across eight feature schemas | PASS (backend unit) |
| V-10 | Low | Rate-limit keys and provider errors are minimized in logs | PASS (backend unit) |
| V-11 | Low | Docs' transaction-scope claim matches the OpenAPI contract, now guarded | PASS (docs guard, 13 tests) |

## V-01 — Unknown analyze statuses were treated as handled

**Correction**

- `SmsTransactionReceiver.kt` replaces the error-prone `status != "recognized"`
  fallback with an exhaustive `when (status)` over `recognized`, `unrecognized`,
  `unavailable` and everything else. Only `unrecognized` is final-negative;
  `unavailable` and any unknown/absent/non-string status keep the candidate.
- `CandidateOutcome` is now `HANDLED | RETRY_UNAVAILABLE | RETRY_UNKNOWN_STATUS |
  RETRY_NOT_FINAL`, and each retry records a `RetryReason`
  (`UNAVAILABLE`, `NOT_FINAL`, `UNKNOWN_STATUS`) so the diagnostic matches the
  cause.
- `PendingWalletCandidates` (Dart) mirrors the same exhaustive switch through
  `CandidateDecision` / `CandidateRetryReason.unknownStatus`; the previous
  `status != 'recognized' → handled` branch is gone.
- `scripts/wallet-sms-contract.test.mjs` no longer pins the defective branch: it
  asserts the new mapping on both sides and fails if a non-final status can
  reach `HANDLED`.

**Verification** — contract tests PASS; Dart unit expectations added for an
unknown status (candidate kept, `attempts` incremented, `retryReason` recorded,
`wallet_sms_quarantined` published). Native runtime remains unexecuted here.

## V-02 — Queue state could be lost by unchecked writes and failures

**Correction**

- Every queue write goes through `commitEntry(...)` / `removeEntry(...)`, which
  check the `commit()` result and publish `flutter.wallet_storage_fault`
  instead of reporting success.
- Decrypt failures and JSON failures no longer delete candidates: they move to a
  sealed quarantine queue (`pending_wallet_quarantine.<uuid>`) whose envelope
  keeps `origin`, `reason`, `attempts`, the original sealed `payload` and
  `quarantinedAtMs`. The record is written before the source is removed.
- Bounded recovery: only `UNREADABLE` entries are retried (max
  `MAX_QUARANTINE_ATTEMPTS = 2`) and only when the payload decrypts again;
  `MALFORMED` entries stay parked so they cannot loop between queues.
- Quarantined entries expire with the same seven-day retention window as queued
  candidates (they still contain sanitized SMS text).
- `WalletQueueCodec` gained `unseal(String)` (re-check a stored value without
  moving it), returns `null` on a failed authenticated decryption instead of
  throwing through the loop, and both codecs fail closed when
  `prefs.setString` returns false.
- `WalletSmsQuarantineStatus` (`wallet_sms_quarantined`, plus
  `hasStorageFault()`) mirrors the native state, and the Money screen renders a
  *Wallet messages kept for review* / *Wallet storage problem* card.
  `wallet_sms_quarantined` replaces the misleading
  `wallet_sms_fallback_unavailable` signal on the "attempts exhausted" path.

**Verification** — contract tests PASS (envelope, bounds, reason gating,
retention, storage-fault publication, Dart mirror). Dart suite updated:
malformed entries quarantined rather than dropped, unreadable entry restored to
its own queue once readable, malformed entries never restored, quarantine
retention expiry. No device/Keystore execution here.

## V-03 — Raw SMS text in the notification

**Correction**

- `DetectedTransaction.rawMessage` was removed, so no code path can render the
  SMS body; the receiver's old `BigTextStyle` builder is gone.
- `showTransactionNotification` uses `NotificationCompat.VISIBILITY_PRIVATE`, a
  channel with `lockscreenVisibility = VISIBILITY_PRIVATE`, a generic
  title/body, and `setPublicVersion(...)` with a redacted builder — so a locked
  device shows only "you have an item to review".
- Amount, direction and currency are appended only when the user opted in via
  `flutter.wallet_notification_details`.
- The opt-in is a real setting: `WalletSmsNotificationDetails`
  (Dart mirror), `SettingsNotifier.setWalletNotificationDetails`, and a Money
  screen switch that only appears while capture is on — default **off**, with
  copy in all six catalogs warning that values may appear on the lock screen.

**Verification** — contract tests PASS (no `rawMessage`, no `BigTextStyle`,
private visibility, public version, opt-in key, UI/copy wiring). Visual
lock-screen behaviour needs a device run: **BLOCKED** here.

## V-04 / V-05 / V-06 — password reset durability, lifecycle and ownership

**Correction**

- New migration
  `1792400000000_password_reset_ownership_and_fencing.cjs`: ownership column,
  fencing/lease columns, status constraint and purge-friendly indexes.
- `reset-request-store.ts` + `password-reset-request.repository.pg.ts`: accept,
  claim with a lease token, complete/fail with an attempt budget, and never let
  two workers process the same request.
- `reset-request-dispatcher.ts` / `worker.ts`: exhaustive outcome handling
  (delivered, retryable, permanently failed, lease lost), no silent drop, no
  infinite retry.
- `password-reset.processor.ts` + `auth.service.ts`: the user's reset request is
  recorded before delivery is attempted and completed after, without turning
  `forgotPassword` into an account-existence oracle.
- `users.repository.pg.ts` deletes reset requests in the account-deletion order;
  the archive excludes them explicitly (see below).

**Verification** — PASS: `backend/tests/unit/password-reset-durability.test.ts`
(13 tests) plus the existing reset/dispatcher suites; 413/413 unit tests green
on a real in-process harness. Real PostgreSQL/Redis execution: **BLOCKED** here.

> Note: `password_reset_requests` is **not** added to the versioned v1 account
> archive. The archive section order is pinned by installed clients, so adding a
> section would make every older verifier reject the export. It is recorded as a
> documented exclusion (`ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS`) and the archive test
> asserts that the table is owned, purged on deletion and documented as excluded.

## V-07 — Cursor pagination did not preserve the requested order

**Correction**

- `features/tasks/tasks.cursor.ts`: versioned (`v: 2`) cursor carrying `sort`,
  `order`, the last row's value for that column and the id tie-breaker. v1 and
  sort-mismatched cursors are rejected with a field-scoped validation error
  instead of silently replaying page one.
- `tasks.repository.pg.ts`: the keyset predicate is generated from the same
  `SORT_COLUMNS` map as the `ORDER BY`, and NULL placement follows PostgreSQL's
  default per direction:
  - `ASC` on a NULL row → the rest of the NULL block only;
  - `ASC` on a value → remaining NULLs (which sort last) plus larger values;
  - `DESC` on a value → smaller values only (the NULL block was already
    returned first, so re-selecting it would repeat rows);
  - `DESC` on a NULL row → the rest of the NULL block, then every non-NULL row.

**Verification** — PASS: `backend/tests/unit/tasks-cursor.test.ts` (12 tests)
compiles the SQL with Kysely and asserts the predicate per sort/direction,
including the two NULL cases and the emitted next cursor. Several-page sorted
integration against PostgreSQL: **BLOCKED** here.

## V-08 — Update and payment paths did not preserve create-time invariants

**Correction**

- New `features/money/money.invariants.ts` validates the **effective** record
  (stored values merged with the request): currency exponent, positive amount,
  real calendar day, at most one day in the future, and kind/category
  compatibility including archived and vanished categories.
- `createTransaction`, `updateTransaction` and `paySubscription` all call it, so
  amount-only, currency-only, kind-only and payment paths can no longer admit a
  state that create would reject.

**Verification** — PASS: `backend/tests/unit/money-invariants.test.ts` plus the
existing money suites. Endpoint-level replay/concurrency runs: **BLOCKED** here.

## V-09 — Shape-only calendar-date validation

**Correction** — `core/validation/date-only.ts` provides one semantic parser
(exact `YYYY-MM-DD`, UTC round-trip, environment-independent) with
`calendarDaySchema`, `calendarDaySchemaFor(field)` and a uniform message. It is
applied to money (including payment dates), goals, habits, projects, tasks,
recurring tasks, calendar and days schemas.

**Verification** — PASS: `backend/tests/unit/calendar-day-validation.test.ts`
(month lengths, leap years, year boundaries, whitespace, impossible days).

## V-10 — Rate-limit diagnostics wrote account identifiers and keys

**Correction** — `core/logger/log-minimization.ts` maps a sensitive key to a
process-salted, non-reversible 16-hex correlation id and reduces errors to their
structural fields (name, SQLSTATE, constraint, table, first stack frame). The
rate limiter logs the correlation id; the error handler logs the summary rather
than raw messages that can embed row values or connection details.

**Verification** — PASS: `backend/tests/unit/log-minimization.test.ts` (5
tests). Deployed log retention/sinks: **NOT RUN** (outside this workspace).

## V-11 — Documentation contradicted the OpenAPI transaction surface

**Correction** — the search-scope row and the Money/transaction prose now state
what is true: transactions stay **out of global search** by product decision,
while the API does publish `GET /money/transactions` and
`GET /money/transactions/{id}`. `scripts/check-docs-consistency.mjs` gained rule
6, which compares the claim with `docs/api/openapi.yaml`; a dated correction
block records the earlier wording in `audit-response-2026-10-24.md`.

**Verification** — PASS: `node scripts/check-docs-consistency.mjs`;
`scripts/docs-consistency.test.mjs` 13/13 (the guard is tested against fixtures,
so a future contradiction fails CI rather than review).

## Residual verification required to close

These cannot be executed in this workspace and must be run in a clean,
approved environment:

1. **Android device**: lock-screen notification content with and without the
   details opt-in, quarantine card behaviour, retry/backoff timing, Keystore
   key invalidation and recovery, retention expiry, storage-fault publication.
2. **Flutter**: `flutter analyze` and `flutter test` (the Dart suite was updated
   for the new semantics but cannot be run here).
3. **Kotlin**: `./gradlew test` / assemble of the release APK.
4. **PostgreSQL + Redis**: multi-page sorted task pagination, concurrent
   transaction update/payment, reset-request fencing under two workers, archive
   streaming and purge after account deletion.
5. **Hosted CI**: the workflows that cover the above gates.

Until those gates run, the findings above are **source-remediated** and
contract-guarded, not runtime-certified.
