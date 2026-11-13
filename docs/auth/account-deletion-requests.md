# Account deletion requests from outside the app

Google Play requires a way to ask for account deletion **outside the app** as well as inside it,
and a link to that web resource in Play Console (Data safety → Delete account URL). LifeStyle's
web resource is the account-deletion page (draft text: `docs/store/data-safety-draft.md`,
section 5). It asks people to email the developer from the account's email address. This page
is the owner's procedure for such an email. In the app, Profile → Delete account does the same
thing without the owner.

## Procedure (owner)

1. **Check the sender.** Act only on a request sent from the account's email address. Otherwise
   reply that the request must come from that address, or that the person can delete the account
   in the app. Never ask for a password.
2. **Run** `docs/auth/sql/schedule-account-deletion-on-request.sql` in the Neon SQL editor on
   production, after replacing the email on the marked line. The block either does everything or
   nothing. It fails with "Expected exactly one account" when the address has no account.
3. **Verify** with the two read-only queries at the end of the file: `pending_deletion` with a
   date about 14 days ahead, then `0 | 0 | 0` (no open sessions, push devices or live reminders).
4. **Reply** with the deletion date (UTC). Tell the person they can still cancel until then by
   signing in to the app and cancelling the deletion in Profile.
5. Delete the email thread once the account has been erased.

The first time, rehearse the file on a Neon branch with a test account.

## What happens next

- The person is signed out everywhere at once; reminders stop and push devices are removed.
- After 14 days the nightly purge erases the account and its data, as for a request made in the
  app. Security logs are kept up to 12 months (deleted by the retention job when
  `DATABASE_MAINTENANCE_URL` is set), then removed.
- The audit log records `user.deletion.requested` as a system action with
  `channel: email_request`.

## Why it mirrors the app

The SQL repeats `UsersRepository.scheduleDeletion` (backend
`src/features/users/users.repository.pg.ts`) for a request with no current session, plus the
audit event written by `UsersService.scheduleDeletion`. If that code changes (for example when
the legacy `ingest_tokens` table is retired), update this file in the same change.
