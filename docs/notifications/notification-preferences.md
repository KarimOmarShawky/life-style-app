# Notification settings and the shared policy (feature guide G2)

Decision record: ADR-046 in `docs/architecture/design-decisions.md`.
Owner decisions (2026-11-11): quiet hours and the daily limit are off until the
user turns them on (22:00–07:00 is suggested); a timed task gets a normal
notification and rings as an alarm only when the user chooses that for the
task; notifications over the limit are combined into one summary instead of
being lost. Alarms ring during quiet hours only when the user allows it.

## What decides a notification

One pure function decides every policy-managed notification: **allow** (at its
time), **delay** (to the end of quiet hours), **digest** (joins that local day's
summary) or **drop** (the master switch is off).

| Code | Path |
|---|---|
| TypeScript (worker push path) | `backend/src/features/notifications/notification-policy.ts` |
| Dart (device scheduler) | `mobile-app/mobile/lib/data/notification_policy.dart` |
| Shared cases both must pass | `mobile-app/mobile/test/fixtures/notification_policy_cases.json` |

Tiers: **Critical** is an alarm the user chose for a task. **Normal** covers
task and calendar reminders. **Low** is for nudges; none exist yet, so the
summary setting for low-priority notifications is stored but not shown in the
app.

Rules: the master switch off drops everything, alarms included. Quiet hours
use the account's local wall clock (`users.timezone`), include the start minute,
exclude the end minute and may cross midnight. A quiet end inside a
daylight-saving gap moves forward by the gap; in a repeated hour, the first
occurrence after the notification wins. The daily limit counts non-critical
notifications per local day of delivery. A day's summary arrives at its first
item's time, moved out of quiet hours, and is never limited. Unknown time zones
fall back to UTC. The policy never sees notification text.

Not managed by the policy: notifications that belong to something the user is
running right now (focus-timer phase changes, the Focus Shield status, and a
snooze the user just pressed on an alarm).

## Where it applies

- **Device (live today):** task reminders and calendar reminders scheduled by
  the app. Summaries are local notifications with generic, content-free text.
  Changing a setting re-plans every upcoming reminder on that device.
- **Server push (gated, not live):** the worker applies the same policy before
  any push, but push stays permanently unavailable (`PUSH_UNAVAILABLE`) until
  E3 ships a provider. `processReminderDispatch` cannot be called without the
  policy store, and `backend/tests/unit/push-policy-gate.test.ts` covers send,
  defer, cancel and summary.
- **Email reminders:** not covered by the policy (no interruption on the
  device). In-app reminders are listed by the API and never interrupt.

## API

`GET /api/v1/notification-preferences` and `PUT /api/v1/notification-preferences`
(authenticated, strict body, 30 requests per 60 seconds per user). See
`docs/api/openapi.yaml`. Example body:

```json
{
  "notificationsEnabled": true,
  "quietHours": { "start": "22:00", "end": "07:00" },
  "dailyLimit": 5,
  "digestEnabled": false,
  "criticalBreaksQuiet": false
}
```

The settings are in the account metadata export (`notificationPreferences`),
erased with the account, and a documented exclusion from the v1 archive file.

## Applying the owner SQL on production

Production (owner-managed Neon) has no migration ledger: never run
`npm run migrate:*` against it (see `docs/database/migrations.md`).

1. In the Neon console, create a branch of `production` (for example
   `g2-rehearsal`) and open the SQL Editor on it.
2. Paste and run the whole of `docs/notifications/sql/notification-preferences.sql`
   once. It is one transaction.
3. Run the verification queries below on the same branch.
4. Switch to `production`, run the file once, then the verification queries.
5. Delete the rehearsal branch.

**Status (2026-11-11, owner-reported):** applied to production after a
rehearsal on a Neon branch of production; the owner reported that the
verification queries below returned the expected `t, t, t, t` and `0`. Device
check G2-7 (saving works after the SQL) is still NOT RUN.

It can run before or after the backend deploy. Until it runs, reading settings
returns the defaults with `available: false`, saving answers 503
`NOTIFICATION_PREFERENCES_UNAVAILABLE` (the app keeps the previous settings and
says they could not be saved), the worker uses the defaults, and export and
account deletion skip the absent table. Running the file a second time fails
harmlessly with `relation "notification_preferences" already exists`; nothing
is changed.

### Verification queries

```sql
SELECT has_table_privilege('lifestyle_app', 'public.notification_preferences', 'SELECT') AS can_select,
       has_table_privilege('lifestyle_app', 'public.notification_preferences', 'INSERT') AS can_insert,
       has_table_privilege('lifestyle_app', 'public.notification_preferences', 'UPDATE') AS can_update,
       has_table_privilege('lifestyle_app', 'public.notification_preferences', 'DELETE') AS can_delete;
-- expected: t, t, t, t

SELECT count(*) AS saved_settings FROM notification_preferences;
-- expected right after applying: 0 (no account has saved settings yet)
```

## Rollback

Forward-only. The table is additive and nothing reads it until the app version
with the settings screen is published; an app without that screen never calls
the endpoint. To stop using saved settings, ship a backend that ignores the
table. Do not drop it on production without exporting it first, because it
holds user choices.
