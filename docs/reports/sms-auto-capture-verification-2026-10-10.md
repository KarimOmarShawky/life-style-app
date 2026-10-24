# SMS auto-capture — verification report (2026-10-10)

> **Historical snapshot (2026-10-10).** This describes the tree as it was on
> that date and is not re-verified by later passes. The wallet SMS contract
> changed afterwards (envelope decoding, `unavailable` retry semantics and
> encrypted local queues); see
> `docs/remediation/audit-response-2026-10-24.md` for the current behaviour.

Scope: finish the remaining verification for SMS auto-capture and related gaps
(option B: implement the gaps first, then verify). Everything marked **verified
here** was executed in this session's sandbox on this branch. Anything marked
**not run here** did not run and is not claimed to pass.

## 1. Gaps implemented and verified (backend)

| Gap | Implementation | Verification |
| :--- | :--- | :--- |
| Raw SMS must not leave the phone | The only egress is `POST /api/v1/ingest/sms/analyze` with **sanitized** text | `sms-sanitizer` unit tests + analyze-flow integration tests assert no real message body appears in the request the analyzer receives |
| Sanitized-only Gemini fallback | `sms-sanitizer.ts` + `GeminiSmsFallbackAnalyzer` (10s budget, 6s upstream cap, `https` keep-alive, `Cache-Control: no-store`) | `sms-fallback-analyzer.test.ts` (12 tests): key never leaves `env.ts`/`container.ts`; nothing logged; response `JSON.parse` (no `response.json()`); all responses destroyed |
| Fallback sanitization | Second pass over model output (`sanitizeModelDescription`, `sanitizeModelMerchant`), redaction tokens `[OTP] [PHONE] [ACCOUNT] [REFERENCE] [URL] [EMAIL] [BALANCE] [FEE] [DATE] [PERCENT] [PROMO] [UNKNOWN]` (no `RAW`, no `SENSITIVE`) | `sms-sanitizer.test.ts` (14 tests) incl. test-message coverage; sensitive fields null-out on violation |
| Strict transaction schema + confidence | `AnalyzedTransaction {kind, amount, currency, occurredOn, description, merchant}`, normalized to 2dp, `EGP` default; **high** only when model says high and merchant is present; unrecognized/unavailable never fabricate | `ingest-analyze.test.ts` (5 tests) + `ingest-analyze-flow.test.ts` (8 tests, contract the app depends on) |
| High may auto-save, low requires review | Backend returns `status/confidence`; the phone saves `high` and parks `low` in the Money review flow | Mobile code written (below); behavior tests run on device (checklist SMS-F-*) |
| Keep Money review flow | Review queue + bottom-sheet with direction and amount edit; Money still has **no full transaction-history list** (per design; results show in budgets/report) | Code + `wallet_review_test.dart` (written; not run here) |
| Related gaps | `POST /ingest/sms/analyze` accepts ingest **or** access token (rate limits 60/min and 20/min; ingest token additionally throttled by session); routes accept both auth types; optional task links for Focus Timer and local calendar reminders unchanged (migrations `1727300003000`/`1727300004000` re-applied) | Integration tests + the migration runs below |

Backend totals (all run in this sandbox with real PostgreSQL 16 + Redis 7):

* `npm test` — **38 files, 282/282 tests passed** (includes the 39 new tests).
* `npm run typecheck`, `lint`, `format:check`, `build`, `check:forbidden`,
  `openapi:check` — all pass. `openapi.yaml` regenerated (`/ingest/sms/analyze` +
  `AnalyzedSms` schemas + ingest-token auth). No `package.json`/lock changes.
* Migrations: `migrate:up` → `migrate:down` → `migrate:up` clean on a scratch
  database (this also covers the timer/task change). From the original PR report
  these files ran against a Neon test branch.
* Upgrade SQL `docs/database/upgrades/2026-10-ingest-tokens-and-optional-timer-task.sql`
  — applied **twice** (idempotent) to a database built only through
  `1727300002000_core_entities`; resulting `ingest_tokens` shape and
  `timer_sessions.task_id` nullability are byte-identical to the migrated path;
  `lifestyle_app` has `INSERT, SELECT, UPDATE` on `ingest_tokens`. Use **either**
  the migrations **or** this file on a given database, never both (after the
  upgrade file, `migrate:up` fails on the existing table — documented in the file).

## 2. Not run in this sandbox (no Flutter/Android toolchain, no production access)

These are written and reviewed but **unverified until a build is made**:

* Kotlin `SmsSanitizer.kt` and `SmsTransactionReceiver.kt` (fallback + review
  flow) — not compiled. Run `flutter build apk` and the device tests below.
* Dart `pending_wallet_reviews.dart`, `money_screen.dart` review card/sheet,
  `home_shell.dart` candidate flush — not analyzed or executed.
  Run `flutter analyze` and `flutter test` in `mobile-app/mobile/`
  (includes the new `test/wallet_review_test.dart`, 7 tests).
* Real-SMS device behavior — `docs/mobile/manual-test-checklist.md` SMS-1..8
  and SMS-F-1..7.

## 3. Production steps (prepared, not run — run them yourself; do not paste
secrets into the repo or chat)

### 3a. Neon — pick ONE path, never both

First verify the target database before any SQL: in the Neon SQL Editor run

```sql
SELECT current_database();                 -- must be the production database name
SELECT * FROM pgmigrations ORDER BY id;    -- decide the path below
```

* **Path A — migration history exists** (query above lists migrations through
  `1727300002000_core_entities`): run `npm run migrate:up` with
  `DATABASE_MIGRATION_URL` pointed at the production database as
  `lifestyle_migrator` (from a trusted network / your terminal), **or** paste
  `1727300003000_ingest_tokens.sql` then `1727300004000_timer_sessions_optional_task.sql`
  in the SQL Editor. Do not also run 3b.
* **Path B — no `pgmigrations` table** (schema-bootstrap database): paste the
  contents of `docs/database/upgrades/2026-10-ingest-tokens-and-optional-timer-task.sql`
  and run it as `lifestyle_migrator`. It is idempotent. Do not also run 3a.

Then verify:

```sql
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns WHERE table_name = 'ingest_tokens'
 ORDER BY ordinal_position;
SELECT is_nullable FROM information_schema.columns
 WHERE table_name = 'timer_sessions' AND column_name = 'task_id';   -- expect YES
```

### 3b. Temporary Railway test deployment (do not overwrite production)

1. In your terminal: `railway login` (never store the token in the repo).
2. Create a **new temporary service** (or a temporary environment) from this
   branch. Set the usual variables from `docs/deployment/environment-variables.md`
   plus `SMS_FALLBACK_GEMINI_KEY` injected from your secret manager — backend
   only; never in mobile build pipelines. Point `DATABASE_URL` /
   `DATABASE_MIGRATION_URL` at the Neon **test** database, not production.
3. Run the migration path above against that test database once.
4. Smoke-test with a dev user: `POST /api/v1/ingest/sms/analyze` with an access
   token and a synthetic sanitized message (never a real SMS); expect
   `200 {status, transaction, confidence}` and `Cache-Control: no-store`. Check
   the service logs show no message text. Without the key expect
   `status: "unavailable"`; with a bad upstream, `503 SMS_FALLBACK_UNAVAILABLE`.
5. Delete the temporary service/environment when done (`railway down` or delete
   in the dashboard).

## 4. Known issues carried over (unchanged)

* The FCM/voice Gemini key is still in APK git history and must be rotated
  (`docs/mobile/manual-test-checklist.md` "Known issues"). The SMS fallback key
  is a **separate** key held only in backend configuration.
* Queued SMS entries are not yet tied to a login session.
* Voice transcription still has the 15-minute token limit.
* fr/de/es/tr catalogs fall back to English for the new review strings.
