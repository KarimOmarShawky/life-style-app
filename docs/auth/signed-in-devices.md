# Signed-in devices (feature guide G6)

ADR-047. The account owner can see where the account is signed in and sign
out one device without signing out everywhere. Owner approval: 2026-11-11.

## API

`GET /api/v1/sessions` (access token required)

- Lists the account's active sessions: not revoked and not past their
  absolute expiry. The session that made the request comes first, with
  `current: true`; the rest follow by last use. At most 50 are listed;
  `truncated: true` says more exist.
- Each item: `id`, `devicePlatform` (`ios`, `android`, `unknown`),
  `deviceName`, `appVersion` (both may be null), `createdAt`, `lastUsedAt`,
  `current`. `lastUsedAt` is the last sign-in or token refresh, not every
  request.
- Never returned: the stored sign-in IP address (`created_ip`), refresh
  tokens or their hashes. Responses are sent with `Cache-Control: no-store`.

`POST /api/v1/sessions/{id}/revoke` with body `{ "currentPassword": "..." }`

- Checks the current password first (`403 REAUTHENTICATION_FAILED` if wrong).
- In one transaction: locks the session row, sets `revoked_at` and
  `revoked_reason = 'user_revoked'`, revokes the session's refresh tokens and
  deletes the push devices registered by that session.
- Access tokens of that session are rejected at their next request, because
  every request re-checks the session.
- `200 { "revoked": true, "current": false }`. `current: true` means the
  caller signed out its own session; the app then finishes a normal logout.
- Revoking a session that already ended answers 200 again. An expired session
  is no longer listed but can still be revoked.
- A session id that is unknown or belongs to another account answers
  `404 NOT_FOUND`, with the same message in both cases.

Limits: 30 requests per 60 seconds per user on both routes. Revoking also
spends the shared re-authentication budget: 5 attempts per 15 minutes per
account, shared with change-password, account deletion and export. Requests
with a malformed id or body are rejected (400) before the budget is spent.

Accounts in the deletion grace period get `403 ACCOUNT_PENDING_DELETION`;
scheduling deletion already signs out every other device.

Each successful revoke writes the audit event `auth.session.revoke` (actor,
calling session, revoked session id, whether it was the current one). The
password and tokens are never logged.

## Applying the owner SQL on production

Production (owner-managed Neon) has no migration ledger: never run
`npm run migrate:*` against it (see `docs/database/migrations.md`).

1. In the Neon console, create a branch of `production` (for example
   `g6-rehearsal`) and open the SQL Editor on it.
2. Paste and run the whole of `docs/auth/sql/auth-sessions-user-revoked.sql`
   once. It is one transaction.
3. Run the verification queries below on the same branch.
4. Switch to `production`, run the file once, then the verification queries.
5. Delete the rehearsal branch.

It can run before or after the backend deploy. Until it runs, signing a device
out still works: the session is stored with reason `logout` instead of
`user_revoked`, and the backend logs one warning. Running the file a second
time replaces the constraint with the same one. No row is changed.

### Verification queries

```sql
SELECT count(*) FILTER (WHERE pg_get_constraintdef(oid) LIKE '%user_revoked%') AS new_check,
       count(*) AS reason_checks
  FROM pg_constraint
 WHERE conrelid = 'auth_sessions'::regclass
   AND contype = 'c'
   AND pg_get_constraintdef(oid) LIKE '%revoked_reason = ANY%';
-- expected: 1, 1   (before the file: 0, 1)

SELECT count(*) AS user_revoked_sessions FROM auth_sessions WHERE revoked_reason = 'user_revoked';
-- expected right after applying: 0 (it grows as people sign devices out)
```

Local rehearsal, not a production run (embedded PostgreSQL 16.15, 2026-11-11):
with the old constraint the first query gave 0, 1 and a revoke stored
`logout`; after running the file twice it gave 1, 1 and a revoke stored
`user_revoked`.

## Rollback

Forward-only. The wider list accepts every value the old one did, and nothing
uses the new value until a device is signed out from the list. To stop using
the feature, ship a backend without the routes or an app without the screen.
Do not narrow the constraint again while rows with `user_revoked` exist: the
statement would fail.
