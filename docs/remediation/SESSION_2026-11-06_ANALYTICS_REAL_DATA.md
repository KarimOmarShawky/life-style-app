# Session 2026-11-06 — real analytics, Gemini failure honesty, SMS/Focus review

Branch: `arena/6fe0b715-life-style-app` (from `main` @ `e6d9242`).
This session did **not** rebuild the app and did **not** touch production.

## Done in code (verified locally where possible)

### Real analytics instead of demo numbers
- New backend endpoint `GET /api/v1/analytics?days=7|30|90|365`
  (`backend/src/features/analytics/`), wired in `container.ts`/`app.ts`,
  documented in OpenAPI (`AnalyticsSummary` schema, regenerated
  `docs/api/openapi.yaml`). It aggregates only the caller's own rows:
  tasks (completed/created by `completed_at`/`created_at` in the user's
  timezone, pending, overdue), habit check-ins, habit consistency
  (per-day recurrence evaluation, only for ranges ≤ 31 days — otherwise
  `null`), finished focus timer sessions, goals (active/achieved and
  mean capped numeric progress, `null` when none), and retained active
  subscriptions with renewals due in 7 days. Series points are daily
  (≤ 31 days) or 7-day buckets. Rates with no denominator are `null`,
  never fabricated zeros.
- Mobile `AnalyticsScreen` rewritten: it fetches the real summary,
  renders metric cards and a tasks-completed trend, shows an honest
  empty state, and removed the hard-coded demo aggregates
  (42/60 tasks, 75% consistency, fake life-balance scores, …) and the
  demo banner. The fake "Life balance" action was removed because no
  real work/health/social/personal data source exists.
- AI insights now send only the real numbers-only aggregates, after a
  per-request consent dialog showing the exact JSON payload (same
  pattern as the Weekly Brain Report). No titles, notes or messages.

### Gemini assistant
- `AiService.getCumulativeAnalysis` / `getPerformanceDashboard` now
  return `null` on provider failure instead of presenting the localized
  fallback sentence as if it were an analysis (they use the existing
  `onOutcome` signal, like `generateWeeklyCoaching`). Prompts instruct
  the model not to invent absent metrics.
- The chat assistant already streams via `streamGenerateContent?alt=sse`
  (`streamMessage`); this session did not change the model or endpoints.
- New Dart tests: analytics model parsing (null stays null, numbers-only
  AI payload) and AI failure-is-null behaviour. Backend unit tests for
  `ratePercent`/`buildSeries` plus an integration test that seeds real
  rows and asserts counts/nulls. **Flutter/Dart and the PostgreSQL
  integration suite cannot run in this sandbox (no Flutter SDK, no
  PostgreSQL/Redis); they must pass in hosted CI for the exact commit.**

### SMS removal (verified in source)
- No `RECEIVE_SMS`/`READ_SMS` permission, no `SMS_RECEIVED` receiver and
  no SMS read path exist in the Android manifest, Kotlin or Dart code
  (repository-wide grep). Focus Shield's notification listener rejects
  every package outside its non-SMS messaging allowlist **before**
  reading notification content. Nothing in the app can read, alter or
  delete the phone's original SMS; that remains outside app scope.

### Focus Shield & reminders (code review, no device proof)
- Accessibility shield blocks only user-selected packages during an
  active, unexpired session; system UI, settings, dialer/phone and
  emergency packages are always safe; temporary bypass and a 1.5 s
  debounce are enforced by the pure `ShieldDecisionEngine`.
- Subscription reminders: the Java scheduler recomputes the renewal at
  09:00 device-local two days before, and receivers reschedule on boot,
  package replacement and time/timezone changes.

## NOT done — still blocked / needs real-world verification

- **Financial erasure on production has NOT happened.** The draft in
  `docs/remediation/drafts/` stays a draft: it must not be run on the
  observed Neon database as-is (absent wallet tables, no `lifestyle_app`
  role, no migration ledger — see `ERASURE_STATUS.md`). No production
  deletion, backup test, role cutover, old-writer drain or Railway
  verification was performed in this session. Merging `main` may have
  auto-deployed to Railway; whether the current build is actually
  running there is unverified.
- **No physical Android device testing**: analytics display, Gemini
  live streaming/errors with a real BYOK key, Focus Shield behaviour,
  09:00 reminders across reboot/timezone changes, and on-device retired
  wallet cleanup all remain unverified. A signed release build is also
  still outstanding.
- Hosted CI must pass for the exact release commit before anything is
  called ready. Release verdict remains **NO-GO**.

## Addendum — "delete what you can" (same day)

Checked for any reachable production data from this environment: no
`.env`, no `DATABASE_URL`/Neon/Railway variables, and sandbox egress is
limited to GitHub/npm/PyPI hosts. **Zero production rows are deletable
from here**, and credentials must not be pasted into chat (per the
original instruction). What was done instead:

- Added `drafts/neon-observed-schema-erasure.sql`: the erasure adapted
  to the observed Neon catalog (the main draft fails there — it locks
  absent wallet tables and requires the absent `lifestyle_app` role).
  One transaction; aborts on unexpected FKs; deletes transactions,
  budgets, categories, ingest tokens, wallet rows if present, and
  financial audit classes; detaches (never deletes) subscriptions;
  verifies emptiness before COMMIT. It is still a **draft**: it does
  not fix the table-owner runtime identity, and must be rehearsed on
  an isolated clone with backups tested before any real run.
- Added `backend/tests/integration/neon-erasure-draft.test.ts`
  (opt-in `TEST_DRAFT_ERASURE=1`, rollback-only) so hosted CI rehearses
  this exact file on real PostgreSQL: retired rows erased, wallet rows
  erased where present, subscription category detached, reminders /
  notes / tasks / non-financial audit preserved.
- Local in-memory rehearsal was attempted; the simulator lacks
  `LOCK TABLE`, `to_regclass` and plpgsql, so full proof is delegated
  to the CI PostgreSQL rehearsal above — not claimed locally.

To actually delete production data, the remaining step is a controlled
window run by whoever holds Neon access: drain Railway writers, take
and test a backup on an isolated clone, run the adapted draft there,
then run it once on production and verify counts. Nothing in this
session performed that run.

## Production erasure EXECUTED — 2026-11-07 (user-operated, guided)

The controlled window above was subsequently executed by the account
owner in the Neon SQL Editor (no credentials were shared in chat):

1. Read-only catalog confirmed on `neondb` as `neondb_owner`:
   tables transactions (0 rows), budgets (1), categories (66),
   ingest_tokens (2), subscriptions (2, none category-linked),
   reminders (0), users (6), tasks (16); wallet tables, `pgmigrations`
   and the retirement marker absent (0 rows returned).
2. Rehearsal: Neon branch `erasure-rehearsal` created from production
   (data + schema). Counts matched production. The adapted draft ran
   successfully (`DELETE 1` budget, `DELETE 66` categories,
   `DELETE 2` ingest tokens, `COMMIT`). Post-run verification:
   retired tables 0; subscriptions 2; users 6; tasks 16.
3. Writers drained: the Railway `life-style-app` service was Sleeping
   (PR #17 merge deployment); its only writer deployment was Removed
   via the deployment menu. Redis left asleep.
4. Production run: the identical script on the production branch
   committed successfully with the same delete counts.
5. Production verification (2026-11-07): transactions 0, budgets 0,
   categories 0, ingest_tokens 0, subscriptions 2 (0 categorised),
   users 6, tasks 16. **App-stored financial rows are erased from the
   production database; subscriptions/accounts/tasks and all
   non-financial data are preserved.** Original phone SMS was never
   in scope and is untouched.

Still outstanding after erasure:
- ~~Delete the `erasure-rehearsal` branch~~ DONE — deleted by the owner
  on 2026-11-07. Neon point-in-time history still retains pre-erasure
  data until its window expires — restoring it would resurrect
  financial data and must not be reconnected.
- ~~Railway has no active deployment. Do NOT redeploy yet~~ DONE —
  redeploy completed and verified live on 2026-11-07. The prepared
  `drafts/neon-runtime-role-and-marker.sql` (the role with its
  password set only by the owner, the empty wallet tables the guard
  requires, and the marker; live-table CRUD for the runtime; retired
  tables locked to SELECT/DELETE + token-revocation for the runtime
  and PUBLIC; self-verifying against the exact guard logic before
  COMMIT; rehearsed rollback-only on real PostgreSQL in CI via
  `backend/tests/integration/neon-runtime-role-draft.test.ts`) was
  rehearsed by the owner on a fresh Neon branch
  (`runtime-role-rehearsal`, verification matched exactly) and then
  executed once on production with the same verification result.
  Railway's `DATABASE_URL` was switched to `lifestyle_app` by the
  owner. Two deployment faults were found and fixed in sequence:
  (1) the generated Railway domain targeted port 3000 while the app
  listens on 8080 (owner corrected the domain target port; requests
  had timed out after 31s with 502); (2) with `NODE_ENV=production`
  the startup guard failed closed because the SQL-created
  `lifestyle_app` role had no password (Neon's console reset refuses
  passwordless roles: "cannot update password for role without
  password"), so the owner set the initial password via `ALTER ROLE`
  in the Neon SQL editor, deleted that history entry, and put the
  same password into Railway's `DATABASE_URL` (password never in
  files or chat). Final live proof: the root URL serves the
  production JSON status (`LifeStyle API` 1.0.1 `healthy`; the HTML
  preview page is only served outside production, so this also
  confirms `NODE_ENV=production` and a passed startup guard), and
  `GET /health/ready` returned `{"status":"ok"}` — live PostgreSQL
  (as `lifestyle_app`) and Redis connectivity from Railway.
  The `runtime-role-rehearsal` branch was deleted by the owner on
  2026-11-07.
- Functional API check PASSED — 2026-11-07 (owner-operated from a
  local PowerShell session; no credentials or tokens shared in
  chat). The owner's first login attempts failed with 401 because
  the owning account's password was not the remembered one, and the
  self-service `POST /api/v1/auth/forgot-password` returned 503
  `SERVICE_UNAVAILABLE` on this deployment (reset-request admission
  unavailable), so the owner reset that account's `password_hash`
  directly in Neon with a pgcrypto bcrypt hash (`crypt(...,
  gen_salt('bf', 12))`, compatible with the app's bcrypt verifier)
  and deleted the SQL history entry. Login then succeeded;
  `GET /api/v1/money/subscriptions` returned both preserved
  subscriptions intact (one shown in detail: active, monthly,
  `categoryId: null` post-erasure detach, next billing projected
  2026-11-16, `reminderDaysBefore: 2`); `GET
  /api/v1/analytics?days=30` returned real account-scoped
  aggregates for `Africa/Cairo` with honest `null` unavailable
  metrics (the owning account holds 0 tasks, so zero task counters
  are genuine; the 16 preserved tasks belong to other, mostly
  throwaway preview-era accounts). API-level functional checks are
  therefore complete; what remains is on-device verification.
- Physical-device and live-Gemini verification remain outstanding;
  release verdict is still NO-GO for the mobile release.

## Local verification performed
- Backend: `tsc --noEmit` (src + tests) OK; unit suite 443 passed;
  new analytics unit tests 4 passed; ESLint and Prettier checks pass;
  OpenAPI regenerated with only the analytics addition.
- Root Node contracts for money retirement, wallet SMS, AI service /
  egress and subscription reminders: 26 passed.
- Not run locally (unavailable here): Flutter analyze/test, Android
  build, PostgreSQL/Redis integration tests, any live Gemini call.
