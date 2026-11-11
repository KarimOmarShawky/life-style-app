# Product events and the Activation / D1 / D7 / D30 funnel (G5)

Feature guide item G5, approved by the owner on 2026-11-10. The design is a
first-party, content-free event table with an account-level opt-out. It is
covered by the account metadata export and by account deletion. No
third-party analytics SDK is involved (ADR-045).

## 1. What is recorded

One row per account, **event name** and **local calendar day**. Only these
columns exist (an integration test fails if a column is added):

| Column | Meaning |
|---|---|
| `id` | Random row id (never exported) |
| `user_id` | Owning account; `ON DELETE CASCADE` |
| `event_name` | One of the six names below (database CHECK) |
| `occurred_at` | **Server** time of the first occurrence that day; clients cannot send a timestamp |
| `occurred_on` | The account's local calendar day at `occurred_at`, from the profile time zone (UTC fallback) |
| `platform` | `android`, `ios` or `unknown` |
| `app_version` | Optional, 1–32 characters of `[0-9A-Za-z.+-]` |
| `created_at` | Insert time |

| Event | Sent when |
|---|---|
| `app_opened` | The app opens for a signed-in account |
| `onboarding_started` | First-run onboarding is shown |
| `onboarding_completed` | The user finishes onboarding |
| `onboarding_skipped` | The user skips onboarding |
| `task_completed` | The user completes a task |
| `habit_checked_in` | The user checks in a habit |

**Never recorded:** task or habit titles, notes, any entity id, screen names,
free text, device identifiers, advertising ids, IP addresses or locations. The
request schema is strict, so a body with any other key is rejected with 400
instead of being silently trimmed. Pino request logs never include bodies.

## 2. API

`POST /api/v1/product-events` with body `{ "event", "platform", "appVersion"? }`.

- Requires authentication. Pending-deletion accounts are blocked by the normal
  account-status rules.
- Rate limit: 60 requests per 60 s per account, plus the global per-IP limit.
- Always answers **202** with `{ "recorded": true | false }`. `false` means
  nothing was stored. That happens when the event was already recorded today,
  when the account opted out, when the server switch is off, or before the
  owner applies the SQL. Clients treat events as fire-and-forget and never
  block a user flow on them.

Account settings live on `PATCH /api/v1/users/me`:

- `productEventsEnabled: false` opts out and **deletes the account's recorded
  events in the same transaction**. `true` opts back in.
- `onboardingCompleted: true` stores `onboarding_completed_at` once.
  Repeating the call keeps the first time. There is no way to re-arm it.

`GET /users/me` returns `productEventsEnabled` and `onboardingCompletedAt`
only when the database supports them. Clients treat an **absent** field as
"feature unavailable": no onboarding prompt and no events. Only an explicit
`onboardingCompletedAt: null` shows onboarding.

## 3. Privacy controls

| Requirement | Where it is enforced |
|---|---|
| Content-free | Strict Zod schema + database CHECKs + fixed column set (tests: `tests/unit/product-events.test.ts`, `tests/integration/product-events-flow.test.ts`) |
| Opt-out | `users.product_events_enabled`. The insert is conditional on it in the same statement, and opting out deletes existing rows atomically |
| Export | `POST /users/me/export` → `productEvents` (name, occurredAt, occurredOn, platform, appVersion), capped at 5000 rows; overflow is 413, not truncation |
| Deletion | `product_events` is in `USER_OWNED_TABLES_IN_DELETE_ORDER` and also cascades from `users` |
| Archive file | Documented v1 exclusion (`ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS`), so installed clients that pin the section order keep working |
| Retention | Nightly worker job `purge-product-events` deletes rows older than 400 days |
| Kill switch | `PRODUCT_EVENTS_ENABLED=false` stops recording without a code change; retention keeps running |
| Least privilege | Runtime role gets `SELECT, INSERT, DELETE` only, no `UPDATE` (checked in the restricted-role rehearsal) |

## 4. Metric definitions

Implemented once in `backend/src/features/product-events/product-events.metrics.ts`.
The copy in [`sql/product-funnel.sql`](sql/product-funnel.sql) is kept identical
by a unit test and returns aggregate counts only.

- **Cohort:** accounts created in `[cohort_from, cohort_to)` that have not
  opted out. Opting out deletes events, so those accounts leave every
  denominator.
- **Meaningful action:** `task_completed` or `habit_checked_in`.
- **Activation:** a meaningful action within **30 minutes** of account
  creation (server time). This approximates "first win in the first session".
- **Time to first win:** median seconds from account creation to the first
  meaningful action, among accounts that have one.
- **Day-N retention (N = 1, 7, 30):** a meaningful action on local calendar
  day `day0 + N`, where `day0` is the creation day in the account's time
  zone. An account is **eligible** only after its day N has fully ended in
  its own time zone at `as_of`. Rates are `retained / eligible`, and
  `eligible = 0` means "not defined yet", never 0 %.
- **Onboarding funnel:** accounts with `onboarding_started`,
  `onboarding_completed` and `onboarding_skipped`.

The definitions are verified on synthetic data across two time zones, an
opted-out account and an out-of-window account
(`tests/integration/product-events-flow.test.ts`).

**Production values: NOT RUN.** The table does not exist in production until
the owner applies the SQL below, and no numbers may be reported before real
events accumulate.

## 5. Production rollout (owner)

The production database is owner-managed and has **no migration ledger**.
Never run `npm run migrate:*` against it (see `docs/database/migrations.md`).

**Status (2026-11-11, owner-reported):** applied to production after a
rehearsal on the Neon branch `g5-rehearsal`; verification returned
`t, t, f` and `0, 0`. The backfill re-run in step 4 is still due before the
app version with onboarding is published.

The SQL and the backend deploy can happen in either order:

- The new backend works before the SQL: no onboarding prompt,
  `recorded: false` for events, and export/deletion behave exactly as before.
- The backend already in production keeps working after the SQL. This was
  checked on 2026-11-10 against `main` at `05f7a04` and the production
  runtime-role SQL (`docs/remediation/drafts/neon-runtime-role-and-marker.sql`).
  The runtime role `lifestyle_app` has table-level privileges on `users`, so
  `SELECT *` still works with the new columns. User rows are mapped field by
  field (`toUserDto`), and inserts name their columns. The startup guard
  checks only the eight retired money tables, so the new grant on
  `product_events` does not trip it.

Steps:

1. Create a Neon **branch** of production and run
   [`sql/product-events-and-onboarding.sql`](sql/product-events-and-onboarding.sql)
   there in the SQL editor. Then run the verification queries below on the
   branch.
2. Run the same file on production. It is a single transaction. Running it
   twice fails harmlessly with "relation already exists".
3. Run the verification queries on production, sign in once with the app to
   confirm nothing changed, then delete the rehearsal branch.
4. Existing accounts are backfilled as "onboarding done". The app shows
   onboarding only when the server sends `onboardingCompletedAt: null`, so
   accounts created after the SQL but before the app version with onboarding
   is published would see it on their first launch of that version. To avoid
   that, re-run only the backfill **right before publishing that app
   version**, never after (genuinely new users would then skip onboarding):

   ```sql
   UPDATE users SET onboarding_completed_at = created_at WHERE onboarding_completed_at IS NULL;
   ```

Verification (read-only):

```sql
SELECT has_table_privilege('lifestyle_app', 'public.product_events', 'INSERT') AS can_insert,
       has_table_privilege('lifestyle_app', 'public.product_events', 'DELETE') AS can_delete,
       has_table_privilege('lifestyle_app', 'public.product_events', 'UPDATE') AS can_update; -- expect t, t, f
SELECT count(*) FILTER (WHERE onboarding_completed_at IS NULL) AS pending_onboarding,
       count(*) FILTER (WHERE NOT product_events_enabled) AS opted_out
FROM users; -- expect 0 and 0 right after the backfill
```

**Rollback:** set `PRODUCT_EVENTS_ENABLED=false` (stops recording at once).
Migrations are forward-only. If the data itself must go, the owner can run
`TRUNCATE product_events;` after a separate decision. The columns are
harmless when unused.
