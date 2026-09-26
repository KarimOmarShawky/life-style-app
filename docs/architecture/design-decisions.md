# Design decisions

Every entry records what was chosen, why, what else was considered, and what the
choice costs. Entries are append-only: when a decision is reversed, add a new
entry that supersedes the old one rather than editing history.

---

## DD-001 — Node.js, Express and TypeScript for the backend

**Decision.** Build the API on Node.js with Express and TypeScript in strict mode.

**Reason.** The technical specification names this stack directly. It also pairs
well with a Flutter client, since both sides are JSON-first and neither needs a
shared runtime.

**Alternatives considered.** Django with Django REST Framework. The earlier
requirements document and the ERD both assumed it, and a Django scaffold was
built before this decision was taken.

**Why rejected.** The specification is explicit and more recent. Keeping Django
would have meant ignoring the stated stack.

**Trade-offs.** The Django work was discarded, and the ERD's Django-specific
notes (`password_hash` described as "Django's built-in hashing", reminders "run
server-side via Celery/Celery Beat") no longer describe the implementation. The
DATA in the ERD is still authoritative; the technology notes in it are not.
Reminder scheduling, which Celery Beat would have provided out of the box, now
needs an explicit job runner. That is not yet built.

---

## DD-002 — PostgreSQL as the primary datastore, MongoDB for two specific slices

**Decision.** PostgreSQL holds every relational entity. MongoDB holds notes and
the audit log, and nothing else.

**Reason.** The specification requires both databases and requires that each
piece of data live where it technically belongs, with a stated source of truth.
Applying that test honestly to this data model:

- Thirteen of the fifteen entities are relational, with real foreign keys,
  ownership constraints and, for money, an exact-arithmetic requirement. They
  belong in PostgreSQL.
- A **note** is the one entity whose shape varies per row: free-form body, an
  arbitrary tag set, and attachments and rich content blocks on the roadmap.
  Relationally that is a join table for tags plus a blocks table, so reading one
  note costs three joins, or a JSONB column, which is a document store with
  extra steps.
- The **audit log** is append-only, never joined, and its metadata differs per
  event type: a login records an IP, a role change records old and new roles.
  It is also the highest-volume write and the least tolerant of latency.

**Alternatives considered.**

1. PostgreSQL only, with JSONB for notes. Genuinely defensible, and simpler to
   operate. Rejected because the specification requires MongoDB to be used where
   the data suits it, and these two cases do suit it.
2. MongoDB only. Rejected outright. Money needs exact decimal arithmetic and
   transactions; users, tasks and reminders need referential integrity.
3. Putting more entities in MongoDB to "balance" the split. Rejected as
   precisely the reasoning the specification warns against.

**Trade-offs, stated plainly.** Notes reference tasks and projects that live in
another database, so those references cannot be foreign keys. See DD-003. Two
datastores also means two backup regimes, two failure modes and two sets of
credentials. This cost is real and is accepted deliberately, not overlooked.

---

## DD-003 — Cross-database references are validated in the application, never assumed atomic

**Decision.** A note's `userId`, `projectId` and `taskId` are plain strings
pointing at PostgreSQL rows. The service validates existence and ownership
before writing. Deleting a task does not cascade into MongoDB.

**Reason.** PostgreSQL and MongoDB are separate systems. A write to each is two
transactions, not one, and no amount of code structure makes them atomic.
Pretending otherwise is the failure the specification calls out at section 8.

**How consistency is actually maintained.**

- **On write:** the service checks the referenced task or project exists and
  belongs to the caller. That check doubles as the ownership check, so a note
  cannot be attached to someone else's task.
- **On read:** a dangling link is tolerated and rendered as unlinked. Reads never
  fail because a referenced row disappeared.
- **On delete:** a reconciliation job clears stale links. It is idempotent, so
  running it twice is harmless.

**Alternatives considered.** A two-phase commit across both databases, and an
outbox with an event consumer.

**Why rejected for now.** Two-phase commit across MongoDB and PostgreSQL is not
practically available and would add a coordinator to a personal productivity
app. The outbox pattern is the right answer at a larger scale and is the
documented upgrade path, but for a single-writer application where the only
cross-database link is optional metadata, a reconciliation job is proportionate.

**Trade-offs.** There is a window where a note points at a deleted task. It is
bounded by the reconciliation interval and is invisible to the user because
reads degrade to unlinked.

---

## DD-004 — Separate secrets for access and refresh tokens

**Decision.** Access and refresh tokens are signed with different secrets, and
the application refuses to start if they match.

**Reason.** With one shared secret, an access token verifies as a refresh token.
An attacker who steals a 15-minute credential could exchange it for a 30-day
session, which erases the entire point of a short access lifetime.

**Alternatives considered.** One secret with a `type` claim checked at
verification.

**Why rejected.** It works, but it relies on every verification path remembering
to check the claim. Separate secrets make the mistake impossible rather than
merely discouraged.

**Trade-offs.** Two secrets to manage and rotate instead of one.

---

## DD-005 — Refresh token rotation with reuse detection

**Decision.** Each refresh token is single-use. Presenting one that has already
been rotated revokes the entire session family.

**Reason.** Rotation alone limits the value of a stolen token. Rotation plus
reuse detection turns theft into a detectable event: once both the attacker and
the legitimate user hold tokens from the same family, whichever of them refreshes
second triggers the alarm, and both are signed out.

**Why the whole family, not just the replayed token.** When a reuse is detected
there is no way to tell which party is the thief. Revoking everything is the only
choice that does not leave an attacker signed in.

**Trade-offs.** A legitimate user can be signed out by a genuine race, for
example two app instances refreshing at once, or a retry after a dropped
response. The cost is one extra sign-in; the alternative is a silent, indefinite
session hijack. The rotation is atomic (a conditional UPDATE reporting its row
count) specifically so that ordinary concurrency does not trip it.

---

## DD-006 — Hand-written SQL migrations rather than a migration library

**Decision.** Numbered `.sql` files applied in order by a small runner, tracked
in `schema_migrations` with a SHA-256 checksum per file.

**Reason.** The whole mechanism is about a hundred lines and adds no dependency.
Migrations stay ordinary SQL that a reviewer can diff and a DBA can read. The
runner adds two properties a naive approach lacks: an advisory lock, so two
instances starting during a rolling deploy cannot both apply the same file, and
checksum verification, so editing an already-applied migration is an error
instead of silent environment drift.

**Alternatives considered.** node-pg-migrate, Prisma Migrate, TypeORM.

**Why rejected.** Each brings a dependency and an abstraction over SQL that this
project does not need, and Prisma in particular would want to own the data
access layer, which conflicts with the repository pattern the specification asks
for.

**Trade-offs.** No automatic `down` migrations. This is deliberate: a generated
rollback that drops a column is more dangerous than not having one. Reversal is
done by writing a new forward migration.

---

## DD-007 — Redis is optional in development, mandatory in production

**Decision.** The application starts without Redis. Caching becomes a no-op and
rate limiting falls back to per-process counters. In production, startup fails if
`REDIS_URL` is missing.

**Reason.** Local development should not require three databases running. In
production, per-process rate limits are simply wrong: with N instances every
limit becomes N times looser, and the session denylist stops working.

**Trade-offs.** Two code paths exist for rate limiting. The gap is closed by
making the production requirement a startup check rather than a convention.

---

## DD-008 — Ownership enforced in the query, not in middleware

**Decision.** Every repository query for user-owned data carries `user_id` in its
WHERE clause. Middleware-level ownership checks are the exception, not the rule.

**Reason.** A middleware check can be forgotten when a new route is added. A
filter inside the query cannot be forgotten, because omitting it means writing a
query that returns the wrong rows and fails its test.

**Trade-offs.** Ownership logic is spread across repository methods instead of
sitting in one visible place. Mitigated by the rule that every user-scoped table
carries `user_id` directly, even where it is derivable through a join.

---

## DD-009 — 404 rather than 403 for resources owned by another user

**Decision.** Requesting a resource that exists but belongs to someone else
returns the same 404 as a resource that does not exist.

**Reason.** Returning 403 for one and 404 for the other tells an attacker which
identifiers are real, which is the enumeration half of an IDOR attack.

**Trade-offs.** Slightly worse developer experience when debugging, since a
genuine permission problem looks like a missing record. The audit log records the
real reason, so the information is available to operators but not to callers.

---

## DD-010 — Audit writes are fire-and-forget

**Decision.** `recordAudit` does not block the request and never fails it. A
write failure is logged at error level.

**Reason.** An audit write must not add latency to a user's request, and a
failure to record an event must not break the event itself.

**Alternatives considered.** Writing the audit entry inside the same transaction
as the operation.

**Why rejected.** Cross-database again: the operation is in PostgreSQL and the
audit entry in MongoDB, so they cannot share a transaction.

**Trade-offs.** The trail can miss entries during a MongoDB outage. Those events
still reach the structured log, so they are recoverable from log storage. A
system with a regulatory audit requirement would need a different answer, most
likely an outbox table in PostgreSQL drained into MongoDB.

---

## DD-011 — Keyset pagination rather than offset

**Decision.** List endpoints page with an opaque cursor encoding `(created_at, id)`,
not with `page` and `offset`.

**Reason.** Two problems with offset. Performance: `LIMIT 20 OFFSET 10000` makes
PostgreSQL walk and discard ten thousand rows before returning anything, so deep
pages get linearly slower. Correctness: inserting a row while a user pages shifts
every subsequent offset, so they see a duplicate or miss an item entirely.

Keyset pagination carries the sort key of the last row seen. Cost is constant per
page, and the result is stable under concurrent writes.

**Why the key is composite.** `created_at` alone is not unique. Two tasks created
in the same millisecond would share a cursor and the page boundary could skip or
repeat one. The id breaks the tie.

**Alternatives considered.** Offset pagination, which is simpler and allows
jumping to page N.

**Why rejected.** This is a mobile app with infinite-scroll lists. Nobody jumps to
page 40 of their tasks, so the one advantage of offset does not apply here.

**Trade-offs.** No total count and no random page access. A count would need a
separate query that costs more than the page itself. The cursor is encoded, not
signed: a client can forge one, which only changes which page of their own rows
they see, because the owner filter is applied separately and is never part of the
cursor. Nothing security-relevant may ever be put in it.

---

## DD-012 — Deleting a project keeps its tasks

**Decision.** `tasks.project_id` uses `ON DELETE SET NULL`. Deleting a project
leaves its tasks in place, ungrouped.

**Reason.** A project is a grouping label, not a container that owns its contents.
Someone tidying up their project list should not silently lose a fortnight of
tasks. The reverse mistake, a stray ungrouped task, is trivially recoverable.

**Alternatives considered.** `ON DELETE CASCADE`, and refusing to delete a project
that still has tasks.

**Why rejected.** Cascade makes an ordinary tidy-up destructive. Refusing the
delete is defensible but forces busy-work: the user must empty a project before
removing it, for no benefit.

**Trade-offs.** Tasks can accumulate with no project. The list endpoint filters by
project, so they remain findable. A `reassignTasksAndDeleteProject` transaction
exists in the repository for the case where tasks should move to another project
instead, but it is not wired to an endpoint yet.

Timer sessions differ deliberately: they use `ON DELETE CASCADE`, because a
session records time spent on one specific task and is meaningless without it.

---

## DD-013 — Timer concurrency handled by a partial unique index

**Decision.** At most one running session per task is enforced by
`CREATE UNIQUE INDEX ... ON timer_sessions (task_id) WHERE end_time IS NULL`,
not by checking for a running session before inserting.

**Reason.** Check-then-insert races. Two taps on Start, or one tap on a flaky
connection that retries, both pass the check and create two overlapping sessions.
The total tracked time is then silently wrong, and nothing surfaces an error. A
partial unique index makes the second insert fail at the database, which the
service reports as a clean 409.

Stop is the mirror image: the UPDATE carries `end_time IS NULL` in its WHERE
clause, so a second stop matches no row and is reported rather than overwriting
the first stop's timestamp.

**Alternatives considered.** An application-level lock, or a `is_running` boolean
on the task.

**Why rejected.** An application lock does not survive multiple instances. A
boolean on the task duplicates state that the sessions table already holds, and
the two can disagree.

**Trade-offs.** The service still performs a friendly pre-check so the common case
returns a helpful message; the index is what makes it correct under concurrency.
That means the check appears twice, which is intentional, not redundant.

---

## DD-014 — Ownership of a referenced resource is validated, and reported as 422

**Decision.** Filing a task under a project runs one query that tests existence
and ownership together. Failure returns 422 naming the `projectId` field, with a
message identical whether the project belongs to someone else or does not exist.

**Reason.** Authorization has to cover references, not just the resource being
addressed. Without this check a user could attach their task to another user's
project, which leaks the project's existence and corrupts that user's task counts.

**Why 422 rather than 404.** The caller is addressing their own collection and
supplied a bad value in the body, so the error belongs to the field. The message
is constant across both failure modes, so this cannot be used to probe for valid
project ids, which is the property that matters.

**Trade-offs.** One extra query per create and per update that touches
`projectId`. Cheap, indexed, and only runs when the field is present.

---

## DD-015 — Notes read tolerantly across the database boundary, and are reconciled separately

**Decision.** A note stores `projectId` and `taskId` pointing at PostgreSQL rows.
Reads resolve those ids in bulk and report an unresolved one as `null`. The
stored value is left alone until `POST /notes/reconcile` clears it.

**Reason.** DD-003 establishes that no foreign key can span the two databases, so
deleting a task cannot cascade into MongoDB. Something has to handle the window
between the delete and the cleanup, and there are only three options: hand the
client a stale id, write on the read path, or hide it. Handing back an id that
404s on the endpoint it names looks like a bug in that endpoint. Writing during a
GET turns the most-read route in the feature into a write and makes an idempotent
request stop being one.

**Why bulk.** Resolution is two queries per page regardless of page size, using
`id = ANY($1::uuid[])`. One query per note would cost 200 round trips for a
100-note page, against a database in another region.

**Trade-offs.** A note keeps a dangling id until reconciliation runs, so
`?taskId=<deleted>` still matches it while the response shows `taskId: null`.
That inconsistency is the honest cost of two databases and is why the reconcile
endpoint exists rather than being deferred. It is currently called on demand;
the reminder job runner will schedule it once that exists.

---

## DD-016 — Note search is a literal substring match, not MongoDB full-text

**Decision.** `?search=` builds a case-insensitive regular expression from the
escaped search term and matches it against the title and the body. The text index
that was originally on the notes collection has been removed.

**Reason.** A notes search box is expected to find "project" when the user has
typed "proj". MongoDB's `$text` does not do that: it matches whole stemmed words,
so partial input returns nothing and the feature reads as broken. It also keeps
the behaviour identical to task search, which uses `ILIKE` against PostgreSQL, so
the Flutter client has one search behaviour to explain rather than two.

**Why the term is escaped.** Unescaped, a search for `c++` is a syntax error and
`(a+)+$` is a denial of service against our own process through catastrophic
backtracking. Escaping every metacharacter turns the term back into literal text,
which is what a search box means. Both cases are covered by tests.

**Trade-offs.** A regex that is not left-anchored cannot use an index, so search
scans the notes the other filters return. The owner and archived conditions bound
that to one user's live notes, which for a personal app is a small set. There is
no relevance ranking. If either becomes a problem, the fix is to add the text
index back for a separate ranked-search mode rather than to change this one.

**Why not keep the unused index.** An index nothing queries still costs write
latency and memory on every insert. Leaving it in place to look thorough is
maintenance debt disguised as foresight.

---

## DD-017 — Archived notes are a separate listing, not a filter over one list

**Decision.** `GET /notes` returns live notes; `?archived=true` returns archived
ones. There is no value that returns both.

**Reason.** Archiving means "get this out of my way". A listing that mixes the two
defeats the feature, and the compound index `{userId, isArchived, createdAt}` is
usable by every listing precisely because `isArchived` is always an equality
condition. A three-state "all" option would make the index unusable for the one
query that asked for it.

**Trade-offs.** A user searching for something they archived must know to tick a
box. Accepted: the alternative is a default listing that fills with notes the user
deliberately put away.

---

## DD-018 — Streaks are computed in SQL, never stored

**Decision.** A habit's current and longest streak are derived on every read by a
single statement using gaps and islands, over the whole page at once. No counter
is kept on the habit row.

**Reason.** A stored counter has to be maintained by every path that touches a
log: marking a day, un-marking it, deleting an entry, back-filling a missed day,
deleting the habit. The first path that forgets leaves a number that is wrong
forever, and nothing detects it because there is nothing to compare against. A
derived value cannot drift from the data it is derived from.

**How the query works.** Each completed log is reduced to an integer period
index — a day number for daily habits, a week number for weekly ones — which is
what lets one statement serve both rhythms. Duplicate periods collapse, so two
logs in the same week count once. Then `period_index - row_number()` is constant
within a run of consecutive periods and changes at every gap, so grouping by it
turns runs into rows: the longest is the longest streak, and the run reaching the
current period is the current one.

**Why period numbering uses a Monday epoch.** Week indices are computed by
dividing a day offset by seven, which is only exact when the origin is itself a
week boundary. `date_trunc('week', ...)` returns a Monday, so the difference is
always a whole number of weeks and integer division never truncates — including
for dates before the origin, where truncation toward zero would merge two
different weeks into one index.

**Why the page is narrowed first.** The ORDER BY and LIMIT sit inside the first
CTE, so streaks are computed for the twenty habits being returned rather than for
every habit the user has ever created.

**Trade-offs.** Reads cost more than reading a column would. The work is bounded
by one user's log rows and served by `habit_logs (habit_id, log_date DESC) WHERE
completed`. If a user ever accumulates enough history for this to matter, the fix
is a materialized summary refreshed on write — but that is the stored counter
again, and it should not be adopted before the cost is real.

**Why `custom` has no streak.** It has no fixed period, so "consecutive" has
nothing to mean. Both fields are null. Returning 0 would be a claim that the
streak is broken, which is a different statement from having none.

---

## DD-019 — A milestone backed by a task takes its completion from that task

**Decision.** `milestones.is_done` is authoritative only for milestones with no
task. When `task_id` is set, completion is `task.status = 'done'`, evaluated on
every read. Setting `isDone` directly on such a milestone returns 409.

**Reason.** The alternative is to keep the flag authoritative and update it
whenever the task changes, which puts the burden on every task write path. The
first one that forgets leaves a goal reporting progress that contradicts the task
list. A user who completes "Write dissertation" in their task list and sees their
goal stay at 25% will conclude the app is broken, and they will be right.

**Why 409 rather than accepting it silently.** A silently ignored write is worse
than a refused one: the client believes it took effect and shows a checked box
that disappears on the next refresh.

**Unlinking.** Sending `taskId: null` persists the completion the milestone was
displaying, in one transaction with the unlink. Otherwise detaching a task from a
finished milestone would make a goal's progress jump backwards for no reason the
user can see.

**Trade-offs.** Every read of a milestone joins `tasks`. The join is on a primary
key and each goal has a handful of milestones. A task may back only one
milestone, enforced by a partial unique index, so the link cannot fan out and
make one task's completion move several goals at once.

---

## DD-020 — Habit dates are calendar dates, with one day of future tolerance

**Decision.** Log dates are `DATE`, compared as `YYYY-MM-DD` strings. A log may be
dated at most one day after the server's UTC date. Reads accept an `asOf`
parameter that decides which period counts as current.

**Reason.** A habit belongs to a day on the user's calendar, not to an instant.
Storing a timestamp would make "did I do this today" depend on the reader's
timezone, and comparing dates as text is exact because that format sorts
identically as text and as a date — no parsing, and no timezone can shift it.

**Why one day of tolerance rather than none.** The server's clock is UTC. At 01:00
in UTC+14 the user's today is the server's tomorrow, and refusing it would make
the app unusable east of the date line for part of every day. One day covers every
real timezone; a client still cannot manufacture a streak by logging a week ahead.

**A bug this replaced.** The first version compared the log date against a bound
derived from the same request's `date` field, so the check could never fail and a
date thirty days out was accepted. The bound is now taken from the server clock
only. Four tests cover it, one of them named for the exact shape of the mistake.

**What is still not solved.** Users have no stored timezone, so `asOf` is the
client's compensation for that rather than a real fix. When a timezone is added to
the user row, streaks should be evaluated against it and `asOf` can become a
debugging aid. It is display-only: a forged value changes nothing but which day
the caller's own numbers are measured against.

## DD-021 — Money is exact decimal end to end, and amounts cross the API as strings

**Decision.** Monetary columns are `NUMERIC(14,2)`. The `pg` driver's default of
returning `NUMERIC` as a string is kept rather than undone, amounts stay strings
through the service and mapper, and they are published as JSON strings:
`{"amount": "1234.50"}`, never `{"amount": 1234.5}`. Every sum, difference and
percentage in the feature is computed by PostgreSQL. Nothing adds two amounts in
JavaScript. Input accepts a string or a JSON number and refuses more than two
decimal places.

**Reason.** The migration chose `NUMERIC` over a floating-point type because
binary floating point cannot represent 0.10 exactly, so sums drift and a spending
report stops reconciling. A JavaScript `number` *is* a double, and `JSON.parse`
turns a JSON number into one. Parsing the column into a `number`, or publishing it
as a JSON number, would reintroduce on the way out the exact error the column type
was chosen to avoid — and would do it at the point where nothing can detect it.
`0.1 + 0.2 + 0.3 + 0.4` is `1.0000000000000002`; the integration suite asserts the
API returns `"1.00"`.

**Why refuse a third decimal place instead of rounding.** A client that computed a
total in floating point sends `0.30000000000000004`. Rounding it stores a number
the user never intended and cannot reconcile against their own records. A 422 is
recoverable and the message says to send a string; a wrong number in a ledger is
not recoverable, because nothing later can tell it apart from a right one.

**Cost.** Clients must treat amounts as strings and do their own decimal maths or
display formatting. That is the correct burden to impose: a client that wants to
add amounts has the same precision problem, and handing it a double would hide it.

**Where rounding is unavoidable.** A yearly subscription normalized to a month is
divided by twelve, which does not always divide exactly. The division runs at full
`NUMERIC` precision and the result is rounded ONCE, on the final sum, rather than
per row — two yearly subscriptions of 100.00 report 16.67 a month, not 16.66. A
test exists for that one cent.

## DD-022 — A subscription's renewal date is an anchor; the next one is derived

**Decision.** `subscriptions.renewal_date` is never advanced. The next billing
date is computed on every read from the anchor and today: count whole periods
elapsed, add that many to the anchor, roll on one more if the result is past.
Both are published — `renewalDate` is the stored anchor the user can edit,
`nextRenewalDate` is when it actually bills. An inactive subscription reports
`null` for both the next date and the countdown.

**Reason.** The obvious implementation rolls the stored date forward when it
passes, which requires a job running every day. The moment that job misses a run
the date is stale, nothing notices, and re-running it double-counts. Deriving has
none of those states: an application left unopened for a year reports the right
date the moment it is opened, and there is no job to operate.

**Why the interval is always added to the anchor, never to the previous result.**
A subscription anchored on the 31st, advanced month by month, lands on the 28th in
February and stays there forever, because 28 plus one month is 28. Adding N months
to the original date gives March the 31st back. This is tested directly.

**Why `null` rather than a date for a cancelled subscription.** A cancelled
subscription has no next billing date. Printing one would tell the user they are
about to be charged for something they stopped. The null also does the filtering
for free in the upcoming-renewals query: `NULL <= anything` is not true, so
inactive rows fall out without a predicate that could be forgotten.

**Cost.** The derivation is a lateral join and cannot be indexed, so the
"what renews soon" query computes it for a user's whole subscription list. That
list is tens of rows, not thousands. The same property is why subscriptions are
paged by `created_at` and not by the derived date: a sort key that changes daily
would let a cursor issued yesterday skip or repeat a row today.

## DD-023 — Budget spending is summed on read, and matched on month, category and currency

**Decision.** A budget stores a limit and nothing else. Spending, remaining,
percentage used and the over-budget flag are computed on every read by summing the
expenses that match the budget's month, category (case-insensitively) and
currency. `percentUsed` is floored and uncapped.

**Reason.** A stored counter must be adjusted by every path that touches an
expense — create, update and delete — and an edit to an expense's date, category,
currency or amount has to adjust *two* budgets, the one it left and the one it
joined. The first path that forgets leaves a budget quietly wrong, with nothing to
compare it against. A sum cannot drift. The integration suite moves an expense
between categories and asserts both budgets are immediately right, with no
invalidation step involved.

**Why currency is part of the match.** 100 USD does not spend an EGP budget.
Without that predicate a budget would be measured against the sum of two different
units and would report nonsense with total confidence. For the same reason, every
total in the spending report is grouped by currency and the API returns one row
per currency rather than a single number.

**Why the category match is case-insensitive.** The unique index is on
`(user_id, lower(category), month)`, so "Food" and "food" are already one budget.
If the spending sum were case-sensitive, that one budget would silently ignore
half the expenses it claims to cover. Filtering and report grouping use the same
rule, so the three agree.

**Why `percentUsed` is floored and not capped at 100.** A budget at 99.6% used
would round to 100 and tell someone they have nothing left while they still do;
flooring can only understate progress, which is the safe direction for a number
someone is about to make a spending decision from. Going over 100 is exactly what
the user needs to see, so it is not capped there, and `remaining` is allowed to be
negative.

It does saturate at a million percent, which is not a display decision. The ratio
is returned as a 32-bit integer, and nothing stops a user setting a limit of one
cent — a few hundred thousand spent against it overflows one, which is a reachable
500 rather than a hypothetical. The same reasoning applies to the sum itself: it
is rounded to two places rather than cast to `numeric(14,2)`, because the cast
raises a numeric-overflow error for a total larger than the column a single
expense fits in. Both have a test.

## DD-024 — An all-day event is snapped to the whole UTC day in the database

**Decision.** `allDay` is not a display hint. When it is set, PostgreSQL rewrites
`start_time` to midnight of that UTC day and `end_time` to 23:59:59.999 of its
own, in the same statement that sets the flag — including when a PATCH sets only
the flag and supplies no times at all.

**Reason.** A flag the backend ignores is a flag two clients will interpret two
ways. An event marked all-day but stored 09:00–10:00 is not on the calendar's
Tuesday row; it is in Tuesday's nine o'clock slot, and every query that asks
"what is on this day" has to know to treat that row specially. Normalizing once,
at write time, means the window query needs no special case and the flag can
never disagree with the times it describes.

Doing it in the UPDATE statement rather than by reading the row, merging and
writing back is what keeps it atomic: the merge version races with a concurrent
edit, and the loser's change disappears with no error.

**Why a millisecond before midnight and not midnight itself.** An all-day event
ending at the next day's 00:00:00 overlaps that day, so a Monday holiday would
appear on Tuesday's calendar. Milliseconds rather than microseconds because
JavaScript's `Date` cannot hold more, and a value the client cannot round-trip
would come back changed.

**The limitation, stated rather than hidden.** The day is the UTC day. For a user
in Cairo, an all-day event runs 03:00 to 02:59 local. Fixing that needs a
timezone on the user, which the schema does not have; `TIMESTAMPTZ` with no such
column leaves UTC as the only answer that is the same on every machine. The
alternative — truncating in the server's local timezone — would make the same
event all-day on different days depending on where the process runs, which is
worse because it is invisible.

## DD-025 — Reminders are delivered by pull, not by a background job

**Decision.** There is no scheduler process. `GET /reminders/due` returns the
pending reminders that have come due, oldest first, and the client acknowledges,
dismisses or snoozes each one.

**Reason.** The same reasoning as DD-022. A job that walks the table and pushes
notifications needs a worker to run it, a lock so two instances do not double
send, a retry policy, and an answer for everything it missed while it was down —
and every one of those is a state that can be wrong without anything noticing.
Pulling has none of them. A phone that was off for a day asks once and gets the
whole backlog in order, and a reminder is delivered exactly when there is
somebody there to see it.

It is also the honest shape for what this deployment is: one process, no Redis in
production yet, no push credentials. Building a scheduler that cannot reach a
device would be machinery with no output.

**Why the due queue is not paginated.** The set changes as the client
acknowledges what it was given, so page two of a scan started a moment ago
describes a queue that no longer exists. A capped single response — take what is
due, deal with it, ask again — is the shape that matches the data.

**Why the transitions are POSTs and not a PATCH of `status`.** Acknowledging sets
`sent_at` with the status, and snoozing rewrites `remind_at` and clears
`sent_at`. Exposing the column directly would invite a client to write `sent`
without a timestamp, which the `reminders_sent_at_matches_status` CHECK would
reject as a 500 rather than a 422. The client names the action; the service owns
the state machine.

**What this leaves for later.** When push notifications arrive they become a
second delivery path on top of this table — `status` and `attempts` are already
shaped for it — and not a replacement, because a push that is never tapped must
still show up in the app.

## DD-026 — Polymorphic references are checked at write, resolved at read, and filtered at delivery

**Decision.** An event may link to a task or a habit; a reminder points at a
task, habit, subscription or event. No foreign key can express that, so the three
things a foreign key does are done explicitly: the target is verified to exist
and belong to the caller before the write, its title is resolved in the same
statement as the row that points at it, and a reminder whose target has been
deleted is excluded from the due queue.

**Reason.** The alternatives are worse. Four nullable foreign-key columns per
table would let two of them be set at once and would need a CHECK to prevent it.
A join table per target type multiplies every query by four. The discriminator is
the shape the ERD already specifies; what it costs is that integrity becomes code
rather than a constraint, so that code is written once, in one module, and tested
on its own.

**Why the title resolution is one CASE of correlated subqueries.** Only one
branch is ever evaluated, so a row pointing at a task never touches the
subscriptions table, and the whole page resolves in the statement that fetched
it — one query, not one per row. Every branch carries `ref.user_id = r.user_id`,
so the resolution path cannot become a way to read across accounts. That property
is asserted by reading the generated SQL in a unit test, because a branch missing
the predicate would behave correctly in every ordinary test and leak the moment
two accounts existed.

**Why a null title is the orphan signal.** Every title column involved is NOT
NULL, so null from that expression means one thing: the target is gone. That
makes "is this reference still good?" answerable without a second query, and it
is what the due-queue filter is built on — firing a reminder for a deleted task
would open a notification onto a 404.

**Why a deleted event takes its reminders and a deleted task does not.** Events
and reminders live in the same slice, so the event delete removes them in the
same transaction. Reaching into the tasks slice to do the same is exactly the
coupling vertical slices exist to prevent. The orphans that leaves are invisible
to the user — never delivered, reported as a dangling reference everywhere
else — but they do occupy rows. A shared "entity deleted" signal, or a periodic
sweep, is the real fix and is not built yet.

## DD-027 — The home summary is computed on every request, not cached

**Decision.** `GET /dashboard` runs one statement and returns the result. There
is no cache entry, and the `user` and `dashboard` cache keys that predated the
feature have been removed along with the eleven service calls that invalidated
one of them.

**Reason.** A cached summary is a stored derived value, and it fails the same way
a stored budget counter does (DD-023): it has to be dropped by every write path
in every feature, and the first one that forgets shows the user a home screen
that contradicts the screen they just came from. That is a worse outcome than a
slower request, because it is not visibly wrong — it is plausibly wrong.

The invalidation calls were already there, one per service, and they are what
made the cost concrete rather than theoretical. They deleted a key nothing ever
wrote: every create, update and delete in the application was paying for a Redis
round trip that could not possibly hit anything. Dead code that looks alive is
worse than no code, because it reads as a working cache in review.

**What it costs to compute.** One statement, one connection, one round trip. The
counts scan the user's own rows in tasks, habits and goals — tens to hundreds of
rows for a person, not thousands — and every list is served by an index that
already existed, including `tasks_user_due_open_idx`, whose own comment in the
migration names this feature.

**Why one statement and not seven in parallel.** The database is hosted in
another region, so latency dominates. Seven sequential queries would be seven
round trips. Seven parallel ones would be one round trip but seven connections
out of a default pool of ten, so two concurrent dashboard requests would starve
everything else. One statement is one of each.

**What would change this.** A measurement. If the summary ever becomes slow
enough to notice, the fix is to cache it with a short TTL and accept that it lags
a write — which is a reasonable trade for a screen that refreshes constantly, but
only once there is a number saying it is needed. The helpers in the cache module
are kept for that.

## DD-028 — The dashboard reads other features' tables, and imports their rules

**Decision.** `features/dashboard` owns no table and queries eight. It is the one
slice allowed to do that. What it is not allowed to do is re-derive a rule that
another slice already defines: the habit period rule and the budget-to-expense
match are imported as SQL fragments from `habit.period` and `budget.match`.

**Reason.** A dashboard is a projection across the whole application; there is no
arrangement of vertical slices in which it does not read widely. The two
alternatives are worse. Importing six other features' repositories couples every
one of them to this endpoint, which is exactly what the slice boundary exists to
prevent. Assembling it in JavaScript from six existing endpoints means six round
trips and the same cross-feature knowledge, just spread out.

What makes the exception safe is that it is READ-ONLY. No write path here can get
out of step with the feature that owns the table, because there is no write path.

**Why rules are imported and lookups are not.** `note.references` duplicates two
ownership lookups rather than importing them, and that is still right: `SELECT 1
WHERE id = $1 AND user_id = $2` cannot drift into meaning something else. A habit
period rule can. "Is this habit done?" has a subtle answer — for a weekly habit it
means anywhere this week — and a second copy would not fail loudly. It would
drift, and the symptom would be a home screen calling a habit outstanding while
the habits screen calls it done, with no error anywhere. The same is true of
which expenses a budget measures, down to the case-insensitive category match.

The fragments imported are SQL strings that run no query and import no module, so
depending on one is not the same as depending on a repository. The test for
whether something belongs in that category: could two copies of it disagree while
both look correct? If yes, extract it.

**Tested.** The integration suite asserts agreement rather than just behaviour: a
weekly habit logged on Monday is reported complete by the dashboard AND by
`GET /habits/:id`, the due-reminder count equals the length of `GET
/reminders/due`, and the over-budget count equals the number of budgets
`GET /budgets` flags. Those three assertions are the point of the suite.

## DD-029 — The unit tier never loads the integration setup, and files run in parallel

**Decision.** `vitest.config.ts` matches `test/integration` and `test/security`
only. The unit tier keeps its own config and its own rule: it must pass on a
machine with no `.env`, no database and no network. `npm test` runs both, unit
first. Within the integration and security tiers, files now run in parallel,
six at a time locally and two on CI.

**Reason, and how it was found.** The main config matched `test/**`, so
`test/setup.ts` ran for every unit file too — opening a MongoDB connection and
closing three clients around eleven assertions about an error class. Those files
each took eighteen seconds. Sixteen of them, nearly five minutes of a local run,
spent waiting on databases they never touch.

That cost was invisible while `MONGODB_URI` was unset, because `connectMongo` was
then a no-op. Configuring MongoDB did not create the waste; it revealed it, and
it arrived mixed in with a database region change, which is how it nearly got
attributed to network latency instead.

**Why parallel is safe here, having been declared unsafe.** The previous setting
was `fileParallelism: false, maxWorkers: 1`, on the stated grounds that the files
share one database and one file's teardown could close connections another file
is still using. That is true across threads and false across processes. `pool:
'forks'` gives every file its own process and therefore its own pool;
`closePostgres` closes only that one; and `TEST_PREFIX` already contains
`process.pid`, which exists for no other reason. The suites were written for
this: `test/setup.ts` forbids asserting on global counts and forbids TRUNCATE.

**Why the worker counts differ.** These suites are latency-bound, not
CPU-bound — almost all of their wall-clock is waiting on a database in another
country, which is exactly the shape of work that parallelises well and the reason
the number is not tied to the core count. CI is the opposite: two cores, and
PostgreSQL in a container on localhost where a round trip costs microseconds.
Six forks there would contend for two cores and win nothing.

**What it cost to get right.** Six workers opening six MongoDB handshakes at once
exceeded the 8-second server-selection budget in one fork. That fork did not
crash — it degraded, exactly as designed, and every note endpoint in it answered
503, which surfaced as a whole security suite failing for a reason that had
nothing to do with notes. The budget is right for a live request, where failing
fast beats hanging, and wrong for a test bootstrap, so the test tier raises it
and the application default stands.

**Result.** 698 pass, 6 skip in both tiers together, in 96 seconds rather than
995, and identical across repeated runs. The same set CI runs, on a developer
machine, for the first time.

## DD-030 — Migrations run in the start command, not in a separate release step

**Decision.** The deployed start command is `npm run migrate:prod && node
dist/server.js`. Every instance runs the migrations before it serves anything.

**Reason.** The alternative is a release phase that runs once, and it fails in a
way that is hard to see: if the release step is skipped, retried, or runs against
a different database than the one the instances connect to, the application
starts against a schema it does not expect and the first affected request is the
notification. Coupling the two removes that gap — an instance that cannot migrate
does not start, so it cannot serve a request against the wrong schema.

**Why this is safe with several instances.** The runner takes a session-level
advisory lock before applying anything (DD-006 covers the runner itself). The
second instance blocks, acquires the lock after the first has finished, finds
every migration recorded, and starts. The lock is the whole reason this pattern
is available, and it is also why `DATABASE_URL` must be Neon's direct endpoint:
PgBouncer's transaction pooling does not preserve session state, so the lock
would be released before it protected anything.

**What it costs.** Startup does one extra round trip per instance even when there
is nothing to apply. On a platform that starts instances often this is the price
of the guarantee, and it is small: six recorded migrations, one query.

**The failure it already caught.** `tsc` emits JavaScript and nothing else, so
the compiled runner shipped without the `.sql` files it exists to apply. It would
have reported `applied: 0, skipped: 0`, exited 0, and let the server start
against a database with no tables — an error that looks like success in every
log. The build now copies the migrations and fails if it cannot find them, which
is the correct place for that to be noticed.

