# Real disposable runtime verification and evidence-led cleanup — 2026-10-16

## What actually executed

Docker, Flutter/Dart and Android SDK were not available. Rather than substitute an
in-memory database or claim mock integration, scratch tools were installed OUTSIDE
application source: embedded PostgreSQL 16.10, psql 16.2 client from pgserver 0.1.4,
and Redis 7.4.6 built from its tagged GitHub source with libc allocator/no TLS.
These are sandbox verification tools, not production image/dependency changes or
certification of their security patch level. No Docker/image/build parity is claimed.

`python scripts/run-disposable-verification.py` creates a new private temporary
PostgreSQL cluster and authenticated Redis process on random loopback ports. It never
accepts an existing DATABASE_URL/REDIS_URL, strips inherited provider settings, refuses
private dotenv files and generates new credentials. It checks the live PostgreSQL
data directory/listen address/postmaster PID and Redis server PID against its owned
processes BEFORE any migration or destructive suite hook. Tests' DELETE FROM users
and FLUSHDB hooks were inspected first; only the new unique lifestyle_test_* database
and Redis database 15 of that owned instance are targets. A private rejecting SMTP
fixture exercises failure behavior only; no real provider mail delivery is certified.

Actual psql executes the repository fresh-role bootstrap, then verifies repeat
bootstrap refusal. Actual node-pg-migrate executes fresh, repeated and synthetic-
populated forward migrations as lifestyle_migrator. The harness checks stable history,
preserved fixture rows, non-superuser runtime identity and refused runtime DDL. An
intentional failing migration in an OWNED temporary copy must roll back its partial
table/history and preserve earlier fixture data. No repository migration is rewritten
or rolled down to make the test pass. This is current-schema fixture coverage, not
an upgrade/restore rehearsal of an unknown deployed legacy schema (C35 BLOCKED).

C15/C16 record the actual integration/security commands inside C32. The first real
integration run had 151 PASS / 3 FAIL (154 cases): deletion scheduling returned 500.
The cause was export pagination accidentally applied to a push-device DELETE, which
PostgreSQL does not support and must not truncate. Removed ORDER BY/LIMIT only from
that owner-scoped DELETE, retained bounded export SELECTs and added a unit regression.
Rerun: all 154 integration tests / 21 files and six security tests / two files PASS.
The live archive projection/snapshot/grants/tenancy and deletion-grace HTTP tests
are now actually executed; prior statements that they were merely authored are history.
The final C32 raw log and disposable-results.json govern subsequent reruns.

Every command has asserted outcomes, including expected nonzero refusals. Secrets
are redacted from captured diagnostics; only the harness's child processes and owned
fixture directory are stopped/removed. No app service, user database, Docker volume,
existing PostgreSQL/Redis data, deployment, commit or push is touched. The remaining
Docker, Flutter/build/signing/provider/device/E2E gates are NOT inferred PASS.

## Cleanup performed, and what was deliberately preserved

Inspection proved the native Gemini key reader unconditionally returned empty. Both
native provider-upload branches and dependent JSON/base64/HTTP, alarm extraction,
nonfunctional backend-sync logging, recording timers/cache scaffolding and unused
imports/helpers were therefore removed. The app no longer records a temporary voice
clip just to enter an always-unconfigured provider branch. No replacement provider,
embedded key, fake transcription or silent success was added.

In-app speech retains the same method channel and locale, now using the already-
existing OS recognition activity directly, with busy/cancel/disposal guards. The OS
recognizer may use its own provider's network service; this is NOT guaranteed offline
speech or proof of no third-party transmission. Android compilation and actual speech
availability, activity lifecycle and notification behavior remain BLOCKED.

Old quick-input notification actions now open the existing app, not a dead microphone
service, and copy no longer promises automatic voice alarms. Stable notification IDs,
receiver/private-service compatibility entry points, existing alarm receiver, SMS/
wallet/archive/Detox channels and saved user alarms/data are preserved. The private
legacy service does not record or schedule an alarm. Removed automatic startup mic
prompt and now-unused RECORD_AUDIO/FOREGROUND_SERVICE_MICROPHONE capabilities; the
OS recognizer activity owns its own capture/permissions. Device behavior still needs
verification, not a source-test assertion. No old user cache/recording is auto-deleted.

C33: eight source-contract checks only (not Android execution). C34: actual TypeScript
`--noUnusedLocals --noUnusedParameters` PASS; it found no backend-source candidates,
so none were invented/deleted. Useful migrations, tests, evidence, reports, exports,
local audio and user data were not removed to reduce file count. This is targeted
cleanup, not a claim that every unused symbol/duplicate in every platform is proven gone.

## Reset timing: admission decoupled; delivery/load/shutdown runtime limits remain

The earlier refresh added one dummy bcrypt comparison for existing-user invalid reset
codes, matching unknown/disabled branches. That operation-parity coverage is retained;
DB/Redis timing is not cryptographically constant-time.

The new forgot-password path admits work before **any account lookup, cooldown check,
OTP creation or SMTP operation**. It returns the existing generic `202 {}` for registered,
unknown, disabled and cooldown cases; a globally full/stopping service returns the same
503 admission refusal independently of the submitted account. The existing IP limiter,
Redis atomic cooldown, HMAC-only OTP store, 15-minute OTP TTL and five-attempt limit
are not relaxed. OpenAPI no longer falsely claims 200, sent email or equalized timing. All six mobile
catalog messages now use conditional best-effort wording, not a sent-email assertion.

One dispatcher belongs to the production singleton AuthService per API process:
64 total waiting+active requests, four concurrent workers, maximum 60-second queue wait.
Only copied email and capped request metadata are queued in memory. Extra caller fields
are projected away; OTPs are generated **after dequeue**, remain worker-local until
SMTP returns and never enter a persistent email queue or diagnostic output. Historical
email-queue deletion stays. AsyncLocalStorage is detached so one HTTP request's user
context is not retained/inherited by other background requests. Expired work and
processing errors produce fixed sanitized diagnostics; SMTP rejection still records
failure, not success, in the audit. SMTP acceptance is not proof of inbox delivery.

This is explicitly **volatile best-effort acceptance**, not durable delivery. Crash,
restart, queue expiry or forced shutdown may lose an accepted request. A user can retry
subject to existing rate limits/cooldown; no fake delivery success or dummy delay is
introduced. Shutdown stops admission immediately and waits for the dispatcher before
closing Redis/PG. The existing 30-second forced-exit cap remains; timeout logs only
counts and explicitly warns that accepted volatile work may be lost. Actual process-
signal/SMTP shutdown choreography and production aggregate load remain unverified.

Seventeen new dispatcher/service/HTTP regressions cover admission before work, stalled
lookup/cooldown/SMTP without holding 202 open, generic inactive cases, queue/concurrency
bounds, expiry, sanitized errors, drain/stop behavior, metadata projection and context
isolation. They are part of final C06, not live-provider or statistical timing proof.
The actual auth integration case now drains admitted work before reading Redis and
asserts HMAC-only storage/audit correlation before proceeding; cleanup drains before
DELETE/FLUSHDB. Tests are never pointed at existing user services. B-27 stays partial
pending production-representative load/timing/provider/shutdown evidence; the earlier
specific synchronous-SMTP request-path gap is no longer left unimplemented.

## Expanded Git-history review, without clearing the detector

The previous 459-blob/one-commit/11-match FAIL is retained in verification-history.md.
Inspection found a shallow checkout. An actual `git fetch --unshallow origin main`
retrieved ancestry without switching branches, changing HEAD, rewriting commits or
pushing. HEAD and fetched main both remain the review baseline; the checkout is no
longer shallow. No historical source is checked out/executed or written to disk by
the detector. Its batches use the pinned detectors with no suppression change.

C36 now covers **1,033 unique UTF-8 blobs across 93 reachable commits**, with **37
connection-string matches in 18 distinct blobs** and eight binary/non-UTF8 exclusions.
Unique-blob matches are not the same inventory as the original 18 source-location
provenance records; duplicated paths/versions are not invented as new independent
credentials or mapped one-to-one to those records. These 37 matches have metadata
only in history-scan.json. Unreachable/unfetched refs, binaries/images and private
runtime configurations are not certified.

C38 independently compares every matched historical URI IN MEMORY with the exact
three development-role defaults in the baseline init-roles.sql, checks approved
historical configuration/test/helper paths and local hosts, and rejects query/fragment
overrides, unknown rules/paths/credentials or remote hosts. **All 37 match those baseline
repository defaults**: 31 declared loopback and six Compose-service URLs. The strict
negative self-test checks that filename alone cannot authorize a classification.
history-provenance.json retains every blob/path/line/rule, comparison decision,
reference commit/path and separate BLOCKED deployed-reuse verdict, without values.
This provenance review can PASS while **C36 remains FAIL**: exposed historical defaults
still exist in Git and could have been copied elsewhere. No history rewrite, allowlist,
rotation or live connection is performed. Original 18 records/hashes remain intact;
SR-07/SR-08 append a documented follow-up fingerprint chain for the authorized CI edit,
rather than overwriting their earlier fingerprints. Deployment inventory/coordinated
rotation remains an owner task if these defaults were reused.
