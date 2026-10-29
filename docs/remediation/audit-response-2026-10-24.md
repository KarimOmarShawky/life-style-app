# Audit response — Independent Verification Audit, 2026-10-24

This is the engineering response to the *LifeStyle App — Final Independent
Verification Audit Report* (25 pages, dated 2026-10-24) whose verdict was
**NOT READY** (Critical 0 · High 0 · Medium 6 · Low 3).

It records, per finding, what was corrected, how it was verified in the
environment where this response was produced, and what still requires a clean,
isolated verification cycle. It is a remediation record, **not** a release
certificate: nothing here claims production readiness.

## Verification vocabulary

The audit's own vocabulary is used, and remediation dispositions are kept
separate from verification outcomes:

| Term | Meaning here |
| :--- | :--- |
| PASS | The stated command executed in this workspace and succeeded. |
| FAIL | The stated command executed and failed. |
| BLOCKED | The command cannot be executed here at all (missing SDK, service or provider). |
| NOT RUN | Not attempted in this workspace. |
| code_unverified | Corrected in source; no runtime proof exists yet. |

## Environment used for this response

Present: Node 20, npm, Python 3, git, GitHub CLI. The backend dependency tree
was installed with `npm ci`.

Absent (all confirmed, not assumed): Docker, PostgreSQL, Redis, a Flutter/Dart
SDK, a Java/Android SDK, hosted CI runners, SMTP/AI/push providers, and any
emulator or physical device. The audit reached the same boundary — it explicitly
labels native runtime, device, provider and hosted-CI verification as not
performed.

Consequence inside this workspace: Dart and Kotlin changes are **syntax- and
contract-verified only**. Dart files were parsed with a WASM build of
`dart_style` (138/138 files parse; 0/138 need formatting) and Kotlin/Gradle were
reviewed statically; no `flutter test`, no `gradlew test`, and no APK was
produced here.

Hosted CI on the pull request **is** available and covers three of those gates,
so the record below separates what this workspace executed from what the hosted
runners executed. Console logs and build artifacts could not be downloaded from
the sandbox (log and artifact hosts are not reachable), so the CI results below
come from the run/job/annotation API — job conclusions and the annotation
messages the workflows emit.

## Status summary

| ID | Severity | Correction | Verification here |
| :--- | :--- | :--- | :--- |
| F-01 | Medium | v1 envelope decoded natively; candidate deleted only after semantic handling | code_unverified (contract tests PASS) |
| F-02 | Medium | `unavailable` separated from `unrecognized`; 503 + bounded retry + visible state | code_unverified (backend tests PASS, contract tests PASS) |
| F-03 | Medium | Rate limiting fails bounded, not open; auth routes opt in | PASS (17 unit tests) |
| F-04 | Medium | Clients request `in_app` everywhere; worker fails push rows permanently | code_unverified (backend tests PASS, contract tests PASS) |
| F-05 | Medium | Queue payloads encrypted with Android Keystore AES-256-GCM; no plaintext fallback | code_unverified (contract tests PASS) |
| F-06 | Medium | Accepted reset work persisted, leased, retried and dead-lettered | PASS on real PostgreSQL/Redis in CI after fixing an ambiguous RETURNING |
| F-07 | Low | Search covers goals and subscriptions; transactions excluded **by product decision, now documented** | code_unverified (unit + contract tests PASS) |
| F-08 | Low | Paths, routes and historical-report labelling corrected | PASS (documents reviewed) |
| F-09 | Low | Trivy filesystem scan enforced (`exit-code: 1`) with a reviewed `.trivyignore` baseline | code_unverified (workflow reviewed; hosted run BLOCKED) |

---

## F-01 — Native Android cannot process the wrapped SMS analyze payload

**Correction.** `SmsTransactionReceiver.kt` now reads the analyze result through
`unwrapAnalyzeResult()`: a `data` member is unwrapped first, so
`{success:true,data:{status,transaction,confidence}}` yields the real status and
transaction, while an already-plain payload keeps working. The candidate is
**removed only after** the result has been handled (saved, queued for review, or
confirmed terminal) instead of before it, so a malformed or unexpected body can
no longer delete the message it failed to interpret. The Dart review path
(`_applyResult`) applies the same handle-before-delete ordering.

**Verification.** `scripts/wallet-sms-contract.test.mjs` asserts the unwrap
helper exists, is used before `handleAnalysisResult`, and that deletion follows
handling (PASS). Backend envelope behaviour is covered by
`backend/tests/unit/ingest-analyze.test.ts` (PASS).

**Not verified.** No Android unit/instrumented test was executed; no device run.

## F-02 — “Unavailable” treated as a terminal non-result

**Correction.**

- Backend: when no provider key is configured, `POST /ingest/sms/analyze` now
  answers **503** with a stable code `SMS_FALLBACK_UNAVAILABLE` instead of a 200
  carrying `status: 'unavailable'`. The state is an outage, not a semantic
  “this is not a transaction”.
- Native: 503 and any `unavailable` status are retryable. Candidates back off
  (`5 min × attempt`, capped), survive for 7 days, and are marked `blocked` at
  the attempt ceiling rather than dropped. Only 400/409/422 are permanent. When
  the fallback cannot be reached the receiver publishes
  `wallet_sms_fallback_unavailable`, and clears it after a successful round-trip.
- Dart: the review queue keeps entries for retryable failures and only discards
  genuine `unrecognized` results or entries past retention.
- UI: the Money screen now shows a “Wallet SMS analysis paused” card when that
  flag is set, so a stalled fallback is visible rather than silent.

**Verification.** Backend unit tests cover the 503 mapping (PASS);
`scripts/wallet-sms-contract.test.mjs` asserts 503/`unavailable` are not in the
native permanent-rejection set, that the flag is published and cleared, and that
the UI reads it (PASS).

**Not verified.** No end-to-end run with the provider key removed, and no
device test of the disabled/timeout/malformed/recovered matrix the audit asked
for.

## F-03 — Authentication throttles fail open when Redis is unavailable

**Correction.** `rate-limiter.ts` no longer returns `allowed: true` on a store
error. A Redis outage now yields a bounded degraded quota
(`ceil(limit / 3)`) with the response header `RateLimit-Degraded: 1`; routes may
opt into `failClosed` for a hard 503. All six authentication limiters in
`auth.routes.ts` were switched to the bounded fallback.

**Verification.** `backend/tests/unit/rate-limiter.test.ts` — 17 tests PASS.

**Not verified.** Fault injection against a live Redis outage (BLOCKED here).

## F-04 — New-event reminders still request unavailable push delivery

**Correction.** The remaining `push` selection was removed from
`event_form_screen.dart` and `calendar_repository.dart`; both now use
`CalendarReminderChannel.inApp` from the new
`lib/features/calendar/data/reminder_channel.dart`, so the channel is named once
instead of being re-typed as a string. On the server, the push sender declares
`permanentlyUnavailable`, so a push row is failed at once and reported as such
instead of retrying forever.

**Verification.** Backend unit tests (PASS), new
`mobile-app/mobile/test/reminder_channel_test.dart`, and a contract test
asserting no `'channel': 'push'` literal remains in client sources (PASS).

**Not verified.** `flutter test` and a real reminder dispatch.

## F-05 — Financial queue payloads remain plaintext in SharedPreferences

**Correction.** New `WalletQueueCipher.kt` (Android Keystore AES-256-GCM, alias
`lifestyle.wallet.queue.v1`, envelope `{"v":2,…}`) seals every
`pending_wallet_tx.*`, `pending_wallet_candidate.*` and
`pending_wallet_review.*` entry. Dart reads and writes them through
`WalletQueueCodec` (`lib/features/money/data/wallet_queue_codec.dart`), which
calls the same platform cipher over a MethodChannel and **fails closed**:
`WalletQueueSecurityException` is thrown rather than falling back to plaintext.
Plain-text v1 values written by an earlier build are still readable and are
re-sealed on the next write. A read that fails because the platform key is
momentarily unavailable keeps the entry instead of deleting it. Backup stays
disabled (`android:allowBackup="false"`).

**Verification.** Contract tests assert encrypt-on-write, Keystore AES-GCM,
7-day retention, codec usage in both Dart stores, and that the test-only
`PlainWalletQueueCodec` appears in no application source (PASS).

**Not verified.** No on-device migration run, no backup/restore rehearsal, no
`gradlew test`.

## F-06 — Accepted password-reset work is volatile

**Correction.** Accepted reset requests are persisted in
`password_reset_requests` (new migration) with attempts, `next_attempt_at`,
lease and status; a processor claims rows with a lease, retries with backoff
(5 attempts, 30 s), and dead-letters what never sends; a `*/2 * * * *` cron
recovers rows whose lease expired. The dispatcher keeps the existing
non-enumerable 202 response and still never discloses account existence.

**Verification.** `backend/tests/unit/password-reset-durability.test.ts` and the
dispatcher tests PASS. The hosted isolated-runtime workflow then ran the
integration and security suites against disposable PostgreSQL 16 and Redis 7
containers: PASS (run 40110764907), including the auth-flow acceptance test that
asserts the OTP reaches Redis after a 202 acknowledgement.

**Corrected after that gate ran.** The first hosted run failed with
`column reference "id" is ambiguous`: with `UPDATE ... FROM`, an unqualified
column in `RETURNING` is ambiguous between the update target and the joined
sub-select, so both claim statements threw. Every accepted request therefore
went straight to `DELIVERY_FAILED` with no OTP ever generated — worse than the
volatile behaviour this replaced, and invisible to the in-memory fakes the unit
tests use. `RETURNING` columns are now qualified with the target alias. This is
exactly the class of defect the audit's P1 item 7 exists to catch.

**Not verified.** Worker execution against a live SMTP provider (BLOCKED here).

## F-07 — Global search limited to five domains

**Correction.** Goals and money (subscriptions) now have owned read-only
readers (`features/goals/goals.reader.ts`, `searchSubscriptions` in
`features/money/money.reader.ts`); `SearchService` composes seven readers and
`SearchResults` returns `goals` and `subscriptions` alongside the original five.
The Flutter client parses both new groups, renders a Goals section, and merges
server-side subscription hits with the local list by id so a row is never shown
twice; a deployment that omits the new groups degrades to “no extra results”
instead of throwing.

**Scope decision, now documented.** Financial **transactions** remain
deliberately out of **global search**, and search must not become a second
transaction-history surface. This is recorded in
`docs/architecture/deferred-and-non-goals.md` — the audit's alternative
“narrow the product wording and UI scope” was taken for transactions.

> **Correction (2026-10-29, V-11).** The earlier wording of this paragraph said
> Money "exposes no transaction-history surface anywhere in the product". That
> was false: the API implements `GET /money/transactions` and
> `GET /money/transactions/{id}` (`money.service.ts` list/get), which the
> OpenAPI contract publishes. What is true, and what the product decision
> actually covers, is that transactions are excluded from global search and the
> mobile app has no dedicated transaction-history screen. The
> documentation-consistency guard now compares this kind of claim with the
> OpenAPI paths, so the contradiction cannot recur silently.

**Verification.** `backend/tests/unit/search-scope.test.ts` PASS; the
`daily_plan_and_lifecycle_test.dart` fixture was extended to assert goals and
subscriptions (NOT RUN here — no Flutter SDK); contract test PASS.

**Not verified.** Query-plan/correctness review on representative data
(BLOCKED here).

## F-08 — Stale documentation

**Correction.** `README.md` now points at `mobile-app/mobile/`;
`docs/architecture/deferred-and-non-goals.md` lists the canonical routes
(`/search`, `/dashboard`, `/day/today`, `/day/{date}`) and states that the old
`/dashboard/overview` and `/days/:date` aliases must not return;
`docs/remediation/report.md` and `docs/reports/spec-verification-2026-10-24.md`
carry “Historical snapshot” banners and no longer describe the current tree as a
patch set.

**Verification.** Document review (PASS); `scripts/check-docs-consistency.mjs`
enforces the corrections in CI and locally, and `scripts/docs-consistency.test.mjs`
proves the guard fails on each piece of drift (11 tests PASS).

**Also corrected, same class.** Stale `cd mobile` / `cd ../mobile` steps in
`README.md`, `mobile/lib/l10n/` in `docs/mobile/flutter-integration.md`, the
"queues remain plaintext" claim in `docs/mobile/digital-detox.md` and
`docs/mobile/flutter-integration.md` (now wrong after F-05), the
"candidates are dropped quietly" note in `docs/mobile/manual-test-checklist.md`
(now wrong after F-02, replaced with a device test SMS-F-8 for the stalled
state), and missing historical banners on two dated reports.

## F-09 — Scanning remains advisory in CI

**Correction.** The Trivy filesystem scan in `.github/workflows/ci.yml` now uses
`exit-code: '1'`, reads `.trivyignore`, and no longer carries
`continue-on-error`. `.trivyignore` is an empty baseline that documents the
exception policy (owner, expiry, reason required for every suppression). A new
CI step runs the wallet/SMS contract suite so the F-01/F-02/F-04/F-05
invariants are enforced on every push, not just reviewed once.

**Verification.** Workflow inspected; `node --test scripts/wallet-sms-contract.test.mjs`
PASS locally. `.trivyignore` starts empty, so no suppression is inherited from
the advisory period.

**Not verified.** No hosted CI run, and image scanning plus a real Trivy
baseline remain to be established on the first clean runner.

---

## Evidence from hosted CI (pull-request runs)

| Workflow / job | Result | What it executed |
| :--- | :--- | :--- |
| Isolated backend runtime verification | PASS (run 40110764907) | Disposable per-job PostgreSQL 16 + Redis 7; forward migrations twice; `npm run test:integration` and `npm run test:security` |
| Flutter and Android debug validation | PASS (run 40110764909) | Dart formatting, `flutter analyze`, `flutter test` (264 tests, 0 failures) |
| Source secret detection | PASS (run 40110764911) | secretlint over 634 current files, 0 findings, plus the detector self-test |
| Backend Quality, Security & API Contract Gate | FAIL at "Set up job" | Pre-existing and environmental: the runner fails to start the job's service containers before any step runs. Identical failure on `main` at `772332e` (run 40090093877), i.e. before any change in this response. |

The Flutter gate was red on this branch at first (254 passed, 10 failed against
a baseline of 257/1). All ten were regressions from this response and are fixed:

- `wallet_review_test.dart` — fixtures were frozen to 2026-10-08, so the 7-day
  retention window added for F-05 expired every candidate before the suite ran
  and `flush()` resolved nothing.
- `reminder_channel_test.dart` (new) — the mock answered the reminder POST with
  an event payload, so `addReminder`'s `{reminder: ...}` parse threw.
- `daily_plan_and_lifecycle_test.dart` — the mock still answered the removed
  `/dashboard/overview` and `/days/:date` aliases, so every request 404'd. Same
  drift class as F-08, in a test rather than a document.
- One Dart digit separator the project's language version does not accept.

## What this response does **not** claim

- No backend HTTP server, worker, migration, or database-backed suite was run
  in this workspace; no Docker, PostgreSQL or Redis is available here. The
  database suites did run on the hosted isolated-runtime workflow (see above).
- No Flutter analyze/test, no Dart VM, no Gradle/Kotlin test, and no APK build
  was executed here. The Flutter analyze/test gate did run on the hosted mobile
  workflow (see above); the Kotlin JVM suite and the APK build are still NOT RUN
  because the mobile workflow skips them unless the Flutter gate passes with a
  validation API configured.
- No external provider (SMTP, Gemini, push), localization/RTL, accessibility,
  offline/interruption, or physical-device verification was performed.
- The audit's P1 item 7 — “run the full clean verification matrix” — is therefore
  still outstanding and is the gate this work is being prepared for.
  `node scripts/run-full-verification.mjs` is the entry point for that cycle: it
  runs every gate it can, reports `BLOCKED` (never `PASS`) for the ones it
  cannot, and can be told to fail when a required gate produces no evidence
  (`--require <gate>`). Usage, guarded database prerequisites and the manual
  pass that remains are written up in `docs/verification/full-cycle.md`.

## Executed evidence attached to this response

| Command | Result |
| :--- | :--- |
| `npm run typecheck` (backend) | PASS |
| `npm run typecheck:tests` (backend) | PASS |
| `npm run lint` (backend) | PASS |
| `npm run format:check` (backend) | PASS |
| `npm run test:unit` (backend) | PASS — 36 files / 377 tests |
| `node --test scripts/*.test.mjs` | PASS — 128 tests |
| Dart syntax + formatting (WASM `dart_style`) | PASS — 138 files parse, 0 need formatting |

Every command above is reproducible in this workspace (the backend suite needs
`npm ci --prefix backend` first). The database and Flutter results in the hosted-CI
table above are not reproducible here and are attributed to their runs.
