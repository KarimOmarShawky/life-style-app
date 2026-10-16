# B-18 reauthentication contract

`POST /api/v1/users/me/export`, `POST /api/v1/users/me/export/archive` and
`POST /api/v1/users/me/deletion` require
JSON `{ "currentPassword": "..." }`. The proof is checked against the authenticated
user's password hash, never against a body-selected user. Missing/extra fields fail
400, incorrect proof fails 403 REAUTHENTICATION_FAILED, and a shared five-attempt /
15-minute per-user budget bounds expensive verification across metadata export, archive and deletion.
Redis unavailability fails these sensitive actions closed with 503 before proof or data
access; the unrelated general fail-open availability policy is preserved. User
responses include Cache-Control: no-store. Authentication and pending-deletion
route restrictions remain enforced.

The mobile profile asks for the current password before either action, passes it
through existing repository/provider flows, and keeps controller ownership in the dialog state through route disposal.
New text uses the English localization catalog with the existing fallback mechanism;
additional translations are not claimed.
It is never persisted or included in export responses/logs. Coordinated client/server
deployment is required: old clients without the proof now fail closed (400).

Real-router unit tests exercise missing/wrong/right proof, unauthorized requests,
identity injection rejection, rate-limit boundaries and Redis-outage rejection. Integration callers are updated
the owned real-database integration suite now executes in C15/C32; mobile UI tests remain BLOCKED. Two dialog widget tests
cover empty/whitespace/cancel/reopen and exit disposal; these are authored, NOT RUN.
The mobile export now previews without automatically copying. Explicit risk
acknowledgement and a Copy action are required; success follows platform confirmation
and failures do not expose provider error strings. Four clipboard widget tests are
authored, NOT RUN. See follow-up-hardening.md for production logger/rate-limit scope.
The current mobile metadata response remains materialized, with server list limits;
native archive provider/device verification and explicit clipboard-copy/history risks remain residuals. This is a partial B-18
remediation, not complete erasure or export assurance.

## Actual export coverage (continued review)
The legacy DTO contains profile, sessions, categories and push-device metadata only.
It is not a full GDPR/data-portability archive. Tasks, notes, habits, events, ledger
records and other domains are absent. API/UI wording now discloses this limitation.
The profile export query does not fetch authentication hashes, and a concurrently
missing account returns controlled 404. Legacy lists now reject overflow above
1000 rows with 413, never silent truncation. An additive backend streamed domain
archive now covers 21 explicit sections with limits/completion validation; real
PostgreSQL projection/snapshot/tenancy fixtures now execute in C15/C32; native saving remains runtime-unverified. Android source now adds
strict streaming verification, encrypted staging and a separate explicit save action;
see `../mobile/account-archive.md` for scoped executed JVM checks and remaining gates. See
`../api/account-archive.md` for its contract and remaining work, and
session-and-scanner-hardening.md for the historical SQL-harness/transaction scope.
