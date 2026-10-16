# Version-1 streamed account domain archive

## Implemented scope and remaining verification

`POST /api/v1/users/me/export/archive` is an additive backend NDJSON attachment.
The old `POST /users/me/export` remains a four-section metadata response for existing
clients; its three lists now each fetch at most 1001 rows and return 413 above 1000,
not a silently truncated result. It is not a consistent full-domain snapshot.

The new archive has 21 explicit profile/domain/metadata projections, covering every
currently user-owned domain table plus profile/session metadata. It includes tasks,
recurring tasks/rules, timers, habits/check-ins, goals/milestones, projects, notes/
links, events, categories, transactions, subscriptions, budgets and reminders, plus
sanitized session/push/ingest-device metadata. Existing soft-deleted rows are included;
already purged data cannot be recovered. No retention policy or historical monetary
value is changed. Future tables/fields require explicit projection/security review.

Backend SQL/control-flow, HTTP and cancellation tests execute with controlled
fixtures. Three live checks (two repository snapshot/grants/tenancy cases and one users-flow
HTTP/grace-period case) now execute against process/data-directory-proven owned
PostgreSQL/Redis in C15/C32. Docker and deployment/proxy/device verification remain
BLOCKED; the hosted workflow is NOT RUN. Android incremental parsing, encrypted private staging and explicit document saving
are now integrated in source (see `../mobile/account-archive.md`). The original
metadata UI remains a separate action. Eight Node fixture/source checks and ten
actual Android-free JVM staging checks execute, but Flutter tests, Android bridge/
app compilation and provider/device verification remain BLOCKED. This is not complete
end-to-end portability or release approval.

## Request security and compatibility

Authentication and strict `{ "currentPassword": "..." }` proof are required. The
caller cannot choose another identity, table, projection, size or filename. Export,
legacy metadata and account deletion share the existing fail-closed reauthentication
budget (five attempts per 15 minutes). A failed security limiter stops work before
password checking or database acquisition. The new route is explicitly allowed in
the same deletion-grace scope as the existing metadata export; disabled accounts
remain blocked by authentication. No credentials are accepted in query strings.

Success headers: `application/x-ndjson; charset=utf-8`, fixed attachment filename
`lifestyle-domain-archive-v1.ndjson`, `Cache-Control: no-store`, and
`X-Accel-Buffering: no`. Reverse-proxy behavior still needs deployment verification.
Do not put password proof in shell history, logs, URLs or an example curl command.
There is no export queue, download token, retained server archive or automatic
clipboard write. TLS and client-side secure storage remain deployment requirements.

## Format and validation

Each frame is one UTF-8 JSON object followed by exactly one LF byte:

1. `type=manifest`: format `lifestyle-domain-archive`, version 1, generation timestamp,
   snapshot mode, ordered sections, exclusions, numeric encoding and limits.
2. `type=record`: `section` and a `data` object with explicit PostgreSQL snake_case
   field names. Ordering is by section then primary-key id. Empty sections have zero
   records but remain listed in the manifest and footer counts. Relationships keep
   their IDs. PostgreSQL numeric amounts/goal values are cast to **decimal strings**
   before JSON construction, avoiding JS floating-point loss. Dates/timestamps use
   PostgreSQL JSON strings with the transaction timezone set to UTC.
3. `type=complete`: per-section `counts`, total `records`, `bytesBeforeComplete`, and
   lowercase hexadecimal `sha256` over the exact bytes of every preceding frame,
   including their LF bytes. The footer itself is not hashed or counted in that
   byte total; it is emitted only after successful COMMIT and the generation audit
   call. The existing audit logger remains best-effort; this is not durable audit
   certification or proof that the client received/saved the file.

A client MUST require one supported manifest, known sections, matching frame counts,
byte count and SHA-256, and exactly one final completion frame before accepting a
saved archive. HTTP 200 or socket EOF alone is insufficient. A hash detects byte
corruption, not malicious replacement; it is not a digital signature. Do not show
success or import a partial archive. Keep bytes unchanged when verifying (no newline,
Unicode, whitespace or decimal normalization). Android source now implements these checks; actual Flutter/bridge/device behavior
is not implied by backend, Node source checks or Android-free JVM tests.

## Exclusions

No password hashes, push delivery tokens, authentication/refresh/ingest token material,
internal idempotency fingerprints, generated search vectors, internal delivery error
payloads, audit logs, Redis/queue state, external-provider or device-only data are
exported. The manifest discloses these exclusions. This is the reviewed version-1
**domain** scope, not a claim to every infrastructure record or every legal request.
User-authored text can itself be sensitive; the resulting plaintext attachment must
be treated as personal data, never logged/uploaded as a test artifact.

## Consistency, resource limits and failures

One dedicated connection uses `REPEATABLE READ READ ONLY`; each source has a bounded
32-row server cursor fetch. Server-side projection returns a null size sentinel for
projected JSON over 512 KiB, instead of sending an unlimited row to Node. A whole
archive is capped at 128 MiB including reserved footer space, with a 60-second
request budget, five-second query deadline and server statement timeout, ten-second
idle-transaction timeout, and at most two active database archive readers per API process/one per
user per process. Capacity is released after database generation, before audit/footer
delivery; this is not a cap on all open HTTP responses. The process cap is not a cluster-wide semaphore. Pool acquisition
uses the existing five-second connection timeout. Large/slow exports fail explicitly;
no resume/background fallback is claimed. These limits may require a later reviewed
large-account mechanism, not silent omission or relaxation.

The HTTP writer honors backpressure before requesting more data. Client disconnect,
query/overall timeout or asynchronous checked-out-client failure terminates the
stream and releases/discards its connection; ordinary early iterator return rolls
back. An async pg error listener prevents an idle-transaction disconnect while
backpressured from becoming an unhandled process error. Stalled audit waiting is
abortable, but this does not claim cancellation of the existing audit logger's
underlying query or guaranteed physical server cleanup under a network outage.

Before response headers, strict validation/authentication, missing-account, capacity,
size and database errors use ordinary sanitized error responses (400/401/403/404/
429/413/503). After headers, errors destroy the response without an error payload or
completion footer. The overall HTTP deadline can also close the connection without
an error envelope. Never reinterpret a partial stream as a successful smaller export.
Real SQL/projection/snapshot/tenancy and runtime grants now have owned-fixture C15/C32
evidence. Deployed schema/grants, proxy behavior, outages/server cleanup under network
failures and native/device behavior still require their separate runtime/release gates.
