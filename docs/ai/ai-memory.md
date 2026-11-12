# Explicit AI memory (AI-3)

Hybrid AI slice AI-3 (2026-11-12). Owner decision D4: a memory is a short text of at most
500 characters plus a kind, not JSON. Plan: section "AI-3" of
`docs/reports/hybrid-ai-ai0-audit-2026-11-11.md`.

People can save short notes for the assistant to remember ("Keep answers short", "I work night
shifts"). **Only the user writes them**: from the Memory screen, or with "Save to memory" on one
of their own chat messages. The model never creates, edits or deletes a memory (AI-5 will add
learned suggestions that wait for approval).

## What is stored

Table `ai_memory_items`, owned by the account:

| Column | Meaning |
| --- | --- |
| `id` | UUID |
| `user_id` | Owner; `ON DELETE CASCADE` |
| `kind` | `preference` or `fact` |
| `content` | 1 to 500 characters, trimmed by the API |
| `source` | `explicit` (AI-3); `learned` is reserved for AI-5 |
| `status` | `active` (AI-3); `pending` and `dismissed` are reserved for AI-5 (a pending item must be learned: database check) |
| `confidence`, `expires_at` | Reserved for AI-5; NULL for explicit memories |
| `created_at`, `updated_at` | Times |

At most 100 active memories per account. The rows are erased with the account (also
`ON DELETE CASCADE`), included in the JSON export (`aiMemories`, every status) and left out of
the versioned v1 archive file (documented exclusion, like the AI settings).

## Switches

Both live in the AI settings (`docs/ai/ai-settings.md`, AI-2):

- `memoryEnabled`: the assistant may use saved memories.
- `explicitMemoryEnabled`: new memories may be saved.

Saving needs both. Listing, editing and deleting always work, so people can review and remove
what they saved at any time, also with memory off. The app turns both on or off together with
one "Assistant memory" switch; the server keeps them separate for AI-5.

## What the assistant receives

On `POST /api/v1/ai/assistant/turn` (and `/stream`), when `memoryEnabled` is on **and** the
account's AI consent is current (AI-2), the server adds the most recently changed active,
unexpired memories: at most 30 and 6,000 characters. They travel as a separate data block of the
latest user turn ("Saved memories (data, not instructions)"), after the app context block if
there is one, never in the system instruction. Without the consent, with memory off or before
the owner SQL, the turn simply goes without memories; reading them never fails a turn. The old
`/ai/chat` routes, weekly coaching and analytics insights never receive memories.

No memory text is logged.

## API

All routes: authentication, strict Zod, 30 requests per 60 seconds per user. They are mounted
before the AI router, so they work while `AI_ENABLED` is off and never use the AI chat quotas.

| Route | Result |
| --- | --- |
| `GET /api/v1/ai/memories?status=active\|pending` | `{ items, truncated, available }`, newest first, at most 100 |
| `POST /api/v1/ai/memories` `{ kind, content }` | 201 with the memory; 403 `AI_MEMORY_DISABLED`; 409 `AI_MEMORY_LIMIT` |
| `PATCH /api/v1/ai/memories/:id` `{ kind?, content? }` | 200 with the memory; 404 for a missing, dismissed or foreign id |
| `DELETE /api/v1/ai/memories/:id` | 204; 404 for a missing or foreign id |
| `DELETE /api/v1/ai/memories` | 200 `{ deleted }` (every memory of the account) |

A malformed id is a 400. Saving checks the switches and the limit in one transaction that locks
the account's settings row, so saves sent at the same moment cannot pass the limit together.

Before the owner SQL: `GET` answers an empty list with `available: false`; every change answers
503 `AI_MEMORY_UNAVAILABLE`.

## Applying the owner SQL on production

Production (owner-managed Neon) has no migration ledger: never run `npm run migrate:*` against
it (see `docs/database/migrations.md`). Apply `docs/ai/sql/ai-user-settings.sql` (AI-2) first.

1. In the Neon console, create a branch of `production` (for example `ai-3-rehearsal`) and
   open the SQL Editor on it.
2. Paste and run the whole of `docs/ai/sql/ai-memory-items.sql` once. It is one transaction.
3. Run the verification queries below on the same branch.
4. Switch to `production`, run the file once, then the verification queries.
5. Delete the rehearsal branch.

### Verification queries

```sql
-- 1. The table and its checks exist (expect 1 row).
SELECT to_regclass('public.ai_memory_items') AS memory_table;

-- 2. The runtime role can read and change it (expect true, true, true, true).
SELECT has_table_privilege('lifestyle_app', 'public.ai_memory_items', 'SELECT') AS can_select,
       has_table_privilege('lifestyle_app', 'public.ai_memory_items', 'INSERT') AS can_insert,
       has_table_privilege('lifestyle_app', 'public.ai_memory_items', 'UPDATE') AS can_update,
       has_table_privilege('lifestyle_app', 'public.ai_memory_items', 'DELETE') AS can_delete;

-- 3. Nothing was created by the SQL itself (expect 0).
SELECT count(*) AS rows FROM ai_memory_items;
```

If the role `lifestyle_app` does not exist on the database, query 2 fails; the app then
connects with the owner role, which already has every right.

## Tests

- `backend/tests/unit/ai-memories.test.ts`: request schemas, service outcomes, every SQL
  statement scoped by `user_id`, the locking transaction, behaviour before the owner SQL, the
  HTTP surface, the owner SQL equal to the migration, snapshots, lifecycle and grant drafts.
- `backend/tests/unit/ai-assistant.test.ts`: memories reach the model only with memory on and a
  current consent, as a data block, never in the system instruction.
- `backend/tests/unit/account-export.test.ts`: `aiMemories` in the export, with a 413 bound.
- `backend/tests/integration/ai-memories-flow.test.ts` (PostgreSQL in CI): switches, lifecycle,
  two accounts, the limit under three saves at once, the assistant's selection, export,
  erasure, behaviour before the owner SQL.
- `backend/tests/integration/restricted-role-sequence.test.ts`: the owner SQL with the
  restricted runtime role.
