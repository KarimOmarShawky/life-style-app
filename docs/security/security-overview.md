# Security overview

Each threat below is documented as: attack scenario, protection, where it is
implemented, and how it is tested. A protection with no test is a claim, not a
control, so the test column names a real test.

All paths are relative to `backend/`.

---

## SQL injection

**Attack.** An attacker submits `a@b.com'; DROP TABLE users; --` as an email,
hoping it is concatenated into a query.

**Protection.** Every statement is parameterized with `$1` placeholders. There is
no string concatenation of user input into SQL anywhere in the codebase. Input is
also validated before it reaches a repository.

**Implementation.** `src/infrastructure/database/postgres/pool.ts` exposes only a
parameterized `query`. `src/features/auth/auth.repository.ts` uses it exclusively.

**Note on identifiers.** Parameterization covers values, not identifiers. A
column or sort direction taken from a request must come from a hardcoded
allowlist. No dynamic identifiers exist yet; the rule is recorded so the first
one added follows it.

**Tested.** `test/security/auth-attacks.test.ts`, four payloads plus a test
proving the table survives.

---

## NoSQL injection

**Attack.** Submitting `{"email": {"$ne": null}, "password": {"$ne": null}}` so a
Mongo query matches any document.

**Protection.** Two layers. Zod rejects an object where a string is expected, so
the operator never reaches a query. Mongoose schemas use `strict: 'throw'`, and
`strictQuery` is enabled, so an undeclared field is an error rather than a
silently stored document.

There is a third layer specific to notes, the one feature that queries MongoDB
with user input: no client value ever becomes a query KEY. `buildNoteFilter`
assembles the filter from fixed field names and validated values only, and a
search term is escaped before it becomes a regular expression, so `.*` searches
for itself instead of matching every note.

**Implementation.** `src/features/auth/auth.validation.ts`,
`src/features/notes/note.validation.ts`, `buildNoteFilter` in
`src/features/notes/note.repository.ts`,
`src/infrastructure/database/mongodb/*.model.ts`.

**Tested.** Three tests covering `$ne`, `$regex` and `$where` on the auth path.
Eleven unit tests assert the note filter document directly, including that the
owner condition survives every combination of filters, that a forged cursor is
rejected, and that a catastrophic backtracking pattern is defused. Six more run
against a real MongoDB in CI.

---

## Account enumeration

**Attack.** Comparing responses or response times between a real and a fake email
to build a list of registered users, then targeting those with credential
stuffing.

**Protection.** Every login failure returns the same code, the same message and
the same status. When the email is unknown, the service still performs a bcrypt
comparison against a dummy hash of the same cost, so the timing profile matches.
A disabled account is only revealed after the correct password is supplied.

**Implementation.** `src/features/auth/auth.service.ts`, `login`;
`TIMING_EQUALIZER_HASH` in `src/core/security/password-hasher.ts`.

**Tested.** An integration test asserts the two responses are byte-identical. A
unit test asserts the equalizer hash is a real bcrypt hash at production cost, so
it cannot silently degrade into an instant return.

**Residual risk, stated honestly.** Timing is equalized for the expensive part,
bcrypt, but not perfectly. The known-email path performs one extra database
round trip to increment the failure counter. Against a remote database this was
measured at roughly 80 ms of difference. Two things bound the exposure: the
authentication rate limit of 10 attempts per 15 minutes per IP and email makes
statistical timing analysis impractical, and the gap shrinks to near zero when
the database is co-located with the API. Closing it fully would mean issuing a
compensating query on the unknown-email path; that was judged not worth the
complexity given the rate limit. Revisit if the limit is ever relaxed.

**Deliberate exception.** Registration does disclose that an email is taken, via
409. A signup form that silently succeeds on a taken address is unusable. Password
reset, where no such excuse exists, must stay silent when it is built.

---

## Brute force and credential stuffing

**Attack.** Automated password guessing against one account, or one password
against many accounts.

**Protection.** Three layers.

1. Rate limiting, 10 attempts per 15 minutes, keyed on IP **and** submitted
   email. IP alone lets one attacker behind a shared address lock out everyone;
   email alone lets a distributed attacker spread across addresses.
2. Account lockout after 5 consecutive failures, for 15 minutes. While locked,
   even the correct password is refused.
3. bcrypt at cost 12, making each guess cost roughly 250 ms of CPU.

**Implementation.** `src/core/middleware/rate-limit.ts`;
`registerFailedLogin` in `src/features/auth/auth.repository.ts`.

**Why the counter increment is a single statement.** `UPDATE ... SET attempts =
attempts + 1 ... RETURNING` performs the increment and the threshold test
atomically. A read-modify-write would let concurrent attempts read the same count
and collectively overshoot the limit.

**Tested.** Two tests: lockout after the configured number of failures including
refusal of the correct password, and counter reset after a successful sign-in.

---

## JWT attacks

**Attack.** Forging a token with `alg: none`, re-signing with a guessed secret,
replaying an expired token, or presenting a refresh token where an access token
is expected.

**Protection.** Verification pins `algorithms: ['HS256']`, so `alg: none` and
algorithm-confusion attacks fail. Issuer and audience are checked. Claims are
shape-checked after signature verification, so a validly signed token with a
nonsense role is still rejected. Access and refresh tokens use different secrets.

**Implementation.** `src/core/security/token-service.ts`.

**Tested.** Nine unit tests plus three security tests, covering alg:none, wrong
secret, wrong issuer, expiry, cross-secret use and malformed claims.

---

## Token theft and session hijacking

**Attack.** Stealing a refresh token from device storage or a network log and
using it indefinitely.

**Protection.** Refresh tokens are single-use. Each refresh rotates the token and
invalidates its predecessor. Replaying a rotated token revokes the entire session
family, signing out both the attacker and the legitimate user.

**Why the whole family.** When reuse is detected there is no way to distinguish
the thief from the victim. Revoking everything is the only option that does not
leave an attacker signed in.

**Storage.** Only a SHA-256 digest of each token is stored, so a database dump
yields no usable credential.

**Implementation.** `refresh` in `src/features/auth/auth.service.ts`;
`rotateRefreshToken` in the repository.

**Tested.** An integration test performs a rotation, replays the original, and
asserts both that reuse is reported and that the legitimate successor is dead.

---

## Privilege escalation

**Attack.** Sending `{"role": "admin"}` or `{"isAdmin": true}` during
registration, or forging a token with an elevated role.

**Protection.** Registration and login schemas use Zod `.strict()`, so an unknown
key is a 422 rather than a silent strip. That choice is deliberate: an attempted
escalation becomes a logged, visible event instead of a quiet success. The role
is assigned by the database default and never read from a request. A forged token
fails signature verification.

**Implementation.** `src/features/auth/auth.validation.ts`;
`src/core/middleware/authorize.ts`.

**Tested.** Three tests covering injected role, injected isAdmin, and a
self-signed admin token.

---

## IDOR and BOLA

**Attack.** Changing a resource id in a URL to read another user's data.

**Protection.** Ownership is enforced inside the query. Every repository read for
user-owned data carries `user_id` in its WHERE clause, so a mismatched id returns
no row rather than someone else's row. A middleware check can be forgotten when a
route is added; a query filter cannot.

**Response code.** Ownership failures return **404**, identical to a genuinely
missing record. Returning 403 for one and 404 for the other would let an attacker
enumerate valid ids.

**Implementation.** `assertOwnership` in `src/core/middleware/authorize.ts`, and
the WHERE clauses in each repository.

**Tested.** 165 access-control tests across six suites. 24 in
`test/security/resource-access.test.ts` cover tasks, projects and timer sessions: a second authenticated user is refused on every
verb, a real foreign id and an invented one produce byte-identical responses, and
a foreign write leaves the owner's row untouched. `test/security/note-access.test.ts`
repeats the scenario for notes, where ownership is a MongoDB filter rather than a
WHERE clause: 23 tests, passing against MongoDB 7 in CI.
`test/security/habit-goal-access.test.ts` adds 22 more for habits and goals,
which introduce two reference paths the earlier features did not have: a habit log
written through an `INSERT ... SELECT`, and a milestone pointing at a task. Both
are places where an ownership check could be dropped with no visible symptom, so
both are attacked directly — including reaching a foreign milestone through a goal
the caller does own.

`test/security/money-access.test.ts` adds 37 for expenses, subscriptions and
budgets. Money is where a broken object reference costs the most: an attacker who
can read someone's expenses learns where they shop, when they travel and what they
earn. It also covers a reference that is **not an id**. A budget finds its spending
by matching category, month and currency rather than by a foreign key, and that
match is scoped to its owner only by a `user_id` predicate inside a lateral join.
Nothing about a request would look wrong if that predicate were missing, so the
suite gives two users a budget with the same category, month and currency and
asserts each sees only its own spending. It also proves a cursor issued to one
user returns none of that user's rows when replayed by another, which is what
makes it safe for cursors to be forgeable base64 rather than signed.

`test/security/schedule-access.test.ts` adds 44 for events and reminders, which
introduce the one attack surface the rest of the API does not have: **a reference
whose target table is chosen by a value in the request**. Two consequences are
attacked directly.

The type and the id have to be checked *together*. Answering "is this a real
entity type?" and "is this one of my ids?" as separate questions passes both for
`{entityType: 'habit', entityId: <my own task's id>}`, and for the same shape
with somebody else's id. The check is therefore one query against the table the
type names, scoped to the caller, and the suite sends both of those shapes.

The resolution path is the other half. Every branch of the `CASE` that fetches a
target's title carries `ref.user_id = r.user_id`; a branch missing it would
behave correctly in every ordinary test — the ids simply would not match — and
would leak the moment two accounts existed. That property is asserted by reading
the generated SQL in `test/unit/schedule-entities.test.ts`, which needs no
database and therefore runs on every push regardless of services.

Two smaller invariants are covered because they are the kind that break quietly.
Deleting an event deletes its reminders in the same transaction, so the suite has
an attacker attempt that delete and then confirms the victim's reminder survived:
a cleanup running before the ownership check answered would have destroyed data
and still returned a 404. And dismissal is deliberately unconditional for the
owner — any status, any number of times — which makes its `user_id` predicate the
only thing between an attacker and silencing someone else's notifications.

`test/security/dashboard-access.test.ts` adds 15 for the home summary, which is
unlike every other endpoint here: it takes no id, so there is no object reference
to get wrong, and it reads eight tables in one statement. That is eight separate
chances to leave a `user_id` predicate off, and a leak would surface as someone
else's numbers folded quietly into your own totals with nothing to point at.

The suite is therefore shaped around totals rather than ids. The victim is given
data in every section; the attacker, none; and every count and list in the
attacker's summary is asserted to be zero and empty. Then the attacker is given a
little data of their own — including a budget with the SAME category, currency
and month as the victim's — and each user's spending is asserted to be measured
against their own expenses alone. That pairing matters because the budget match
is a join on values rather than on an id, and its owner predicate sits inside the
join where nothing about a request would look wrong if it were missing.

The last test is a backstop rather than a specific claim: no string the victim
ever typed may appear anywhere in the attacker's response body. A section added
later is covered by it without anyone remembering to extend the suite.

---

## Information disclosure

**Attack.** Triggering an error to extract a stack trace, SQL, a connection
string or an environment variable.

**Protection.** `AppError` separates the client-safe `code` and `message` from
internal `metadata` and `cause`. Serialization is the boundary, so there is no
call site that can forget to strip a field. Stack traces are withheld in
production. Unrecognized errors become a generic 500, so a new library error
fails closed.

**Log redaction.** The logger scrubs a list of sensitive field names at every
nesting level, and connection strings are masked before they are logged.

**Implementation.** `src/core/errors/app-error.ts`,
`src/core/middleware/error-handler.ts`, `src/core/logger/redaction.ts`.

**Tested.** Unit tests assert metadata, constraint names and connection strings
never survive serialization. Security tests assert no secrets appear in a 404
body and that `x-powered-by` is absent.

---

## Header and transport hardening

**Protection.** Helmet sets `nosniff`, `X-Frame-Options: DENY`, a referrer policy
and a content security policy. HSTS is enabled in production only, because
enabling it on localhost forces HTTPS there afterwards in a way that is hard to
undo. CORS uses an explicit origin list and refuses to start in production with
an empty one.

**CORS is not access control.** It constrains browsers only. A native client or a
script ignores it entirely. Authentication and authorization on every route are
the real control.

**Tested.** Security tests assert each header is present.

---

## Request correlation and log forging

**Attack.** Supplying an `X-Request-Id` containing control characters to inject a
fake log line or a response header.

**Protection.** An inbound id is accepted only if it is at most 64 characters and
matches `[A-Za-z0-9_-]+`. Anything else is discarded and a fresh UUID issued.

**Tested.** A well-formed id is honoured; oversized, empty and
unsafe-character ids are all replaced with a UUID.

---

## What is not yet implemented

Listed so the gap is visible rather than assumed covered:

- File upload validation. No upload endpoint exists yet.
- CSRF tokens. The mobile client authenticates with a Bearer header, which has no
  ambient-credential problem. The refresh cookie is `SameSite=Strict`. A CSRF
  token becomes necessary if a browser client starts relying on cookie auth.
- Password reset. Must be enumeration-silent when built.
- Role-based admin endpoints. The `authorize` middleware exists and is tested at
  unit level, but no admin route uses it yet.
- Mid-request MongoDB failure. Degradation is verified for a MongoDB that is
  absent at startup, not for one that disappears while a request is in flight.
  The driver's own timeout covers it, but no test asserts the response.
