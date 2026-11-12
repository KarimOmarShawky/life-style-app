# AI settings and the durable AI consent (AI-2)

Hybrid AI slice AI-2, part 1 (2026-11-12). Owner decisions D3 (no provider choice for
users), D4 and D5 (one durable, versioned consent). Plan: section "AI-2" of
`docs/reports/hybrid-ai-ai0-audit-2026-11-11.md`.

Today the app asks "Send conversation to Google Gemini?" and keeps the answer only in
memory. This part stores the answer on the server, per account and per version of the
consent text, so it survives reinstalls and devices. The app starts using it in AI-2c;
AI-2b uses it to decide whether personal context (today's tasks, habits, goals, events)
may be sent: `POST /api/v1/ai/assistant/turn` denies context with `consent_required`
unless the stored version equals the current one (`docs/ai/ai-assistant-context.md`).

## What is stored

Table `ai_user_settings`, at most one row per account. No row means the defaults.

| Column | Default | Meaning |
| --- | --- | --- |
| `egress_consent_version` | NULL | Version of the consent text the account agreed to; NULL = never or withdrawn |
| `egress_consent_at` | NULL | When; set together with the version (database check) |
| `memory_enabled`, `explicit_memory_enabled` | false | For AI-3 (explicit memory); nothing reads them yet |
| `learning_enabled` | false | For AI-5 (inferred preferences); nothing reads it yet |
| `quick_actions_enabled` | false | For AI-4 (confirmed proposals); nothing reads it yet |
| `language_mode` | `auto` | `auto`: reply in the language of the message; `app_locale`: in the app language (`clientLocale` from the app, else the account locale; used by the AI-2b assistant turn) |

No prompt, reply, memory text or provider choice is stored. The row is erased with the
account (also `ON DELETE CASCADE`), included in the JSON export (`aiSettings`) and left
out of the versioned v1 archive file (documented exclusion).

The current consent version is `AI_EGRESS_CONSENT_VERSION` in
`backend/src/features/ai-settings/ai-settings.types.ts` (now 1). Raise it when the consent
text changes materially: every account then has to agree again.

## API

`GET /api/v1/ai/settings` (auth, 30 per minute per user):

```json
{
  "settings": {
    "egressConsentVersion": 1,
    "egressConsentAt": "2026-11-12T09:00:00.000Z",
    "memoryEnabled": false,
    "explicitMemoryEnabled": false,
    "learningEnabled": false,
    "quickActionsEnabled": false,
    "languageMode": "auto"
  },
  "currentConsentVersion": 1,
  "available": true
}
```

`PATCH /api/v1/ai/settings` (auth, strict body, at least one field, same limit) changes
only the fields sent, in one statement, for an active account:

- `{"egressConsentVersion": 1}` records the consent. Any other number answers 409
  `AI_CONSENT_VERSION_MISMATCH`, and the app shows the current text again.
- `{"egressConsentVersion": null}` withdraws it.
- `{"languageMode": "app_locale"}` and the switches change only themselves.

Both work while `AI_ENABLED` is off and do not use the AI chat quotas (the router is
mounted before the AI router). Until the owner SQL runs, GET returns the defaults with
`available: false` and PATCH answers 503 `AI_SETTINGS_UNAVAILABLE`.

## Applying the owner SQL on production

Production (owner-managed Neon) has no migration ledger: never run
`npm run migrate:*` against it (see `docs/database/migrations.md`).

1. In the Neon console, create a branch of `production` (for example
   `ai-2-rehearsal`) and open the SQL Editor on it.
2. Paste and run the whole of `docs/ai/sql/ai-user-settings.sql` once. It is one
   transaction.
3. Run the verification queries below on the same branch.
4. Switch to `production`, run the file once, then the verification queries.
5. Delete the rehearsal branch.

**Status:** not applied yet. It can run together with `docs/ai/sql/ai-content-reports.sql`
(AI-P), before or after the deploy.

Running the file a second time fails harmlessly with
`relation "ai_user_settings" already exists`; nothing is changed.

### Verification queries

```sql
SELECT has_table_privilege('lifestyle_app', 'public.ai_user_settings', 'SELECT') AS can_select,
       has_table_privilege('lifestyle_app', 'public.ai_user_settings', 'INSERT') AS can_insert,
       has_table_privilege('lifestyle_app', 'public.ai_user_settings', 'UPDATE') AS can_update,
       has_table_privilege('lifestyle_app', 'public.ai_user_settings', 'DELETE') AS can_delete;
-- expected: t, t, t, t

SELECT count(*) AS rows FROM ai_user_settings;
-- expected right after applying: 0
```

## Tests

- `backend/tests/unit/ai-settings.test.ts`: strict body, consent version (409),
  503 before the SQL, kill switch off, 30-per-minute limit, partial-update SQL,
  owner SQL byte-identical to the migration, snapshots, erasure, grant drafts.
- `backend/tests/integration/ai-settings-flow.test.ts` (PostgreSQL, CI): defaults,
  consent, partial updates keep other fields, isolation between accounts, export,
  erasure, behaviour without the table.
- `backend/tests/integration/restricted-role-sequence.test.ts`: the runtime role before
  and after the owner SQL.

## Rollback

Forward-only. The table is additive. If the routes are removed, the app keeps asking for
consent on the device as before. Do not drop the table on production without exporting
it first: it holds each account's consent record.
