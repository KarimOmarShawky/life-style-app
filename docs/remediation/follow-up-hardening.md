# Follow-up hardening — 2026-10-15

The user requested additional safe actionable work after the first delivery.
These changes extend the existing B-18/B-16 scope; they are not new independent
audit IDs and do not change the 57-record / 37-overlap-group reconciliation.

## 1. Sensitive-action outage protection and cache privacy

Root cause: the existing Redis limiter deliberately failed open for general
availability, so its newly added sensitive-action caller inherited unlimited
password attempts during a Redis outage. Preserve the original general policy;
report an explicit `unavailable` result and opt only export/deletion into fail-closed
behavior. They return 503 SERVICE_UNAVAILABLE before password verification or data
mutation. Normal quota exhaustion remains 429. No policy threshold was changed.
All user-router responses now include Cache-Control: no-store, including errors.

Increment, TTL lookup and initial/repair expiry now use one Lua operation instead
of a pipeline followed by a separate EXPIRE round trip. This prevents interleaved
first-hit expiry resets and the ordinary two-round-trip failure gap. The in-memory
limiter now resets at the exact expiry boundary (>=, not >). Lua errors are reported
as unavailable; Redis scripts are not rollback transactions, so a partial write on
an ACL/runtime error is not claimed impossible. Redis credentials/errors are not
included in outage logs. Redis ACLs must permit the script's commands.

Verification: real-router HTTP units for both actions assert 503/no proof/no export
or deletion during a fake Redis outage, plus no-store on success/error. Nine rate
limiter unit tests cover quota, expiry, key separation, Lua call/result contract,
malformed results, secret-free outage logging, fail-closed and preserved general
fail-open behavior. PASS in the 213-test / 24-file backend run. The Redis dependency
is a fake: actual Lua execution/concurrency/failover remains BLOCKED without an
isolated Redis instance. No live data service was contacted.

## 2. Actual production logging configuration

Root cause: the old logger test created a separate Pino instance with its own
redaction settings, rather than verifying the production configuration. Existing
paths also stopped short of req.headers / nested token response fields.

`createLogger(destination)` is now the same factory used by production and by
capture-stream tests. Known credential fields are redacted at top level and one
or two nested object levels, including password proof, token responses and headers.
The complete req/request/res/response body containers are suppressed, so arbitrary
depth HTTP financial/private payloads are not logged through those containers.
Tests verify actual output, async request-context separation and no input mutation.
Four logger units PASS in the backend run.

Scope limit: this is NOT arbitrary recursive secret discovery, free-text message
scrubbing or a certification that every historical/third-party log is safe. Never
put credentials in log messages, provider error strings or custom unbounded objects.
Legacy queue/log/snapshot retention remains governed by the deployment runbook.

## 3. Explicit export clipboard consent

Root cause: opening an account export automatically put all personal/financial JSON
onto the system clipboard. The mobile profile no longer performs that write.
A dedicated dialog shows a bounded preview and truthful clipboard-history/sync
warning. Copy is disabled until acknowledgement, and still requires an explicit
Copy action. Success appears only after the platform method completes. A platform
failure shows a generic error (no provider exception) and permits retry.

No automatic clipboard clearing or history revocation is claimed. The legacy
metadata action does not save an archive file. Clearing later could overwrite unrelated clipboard contents and would
not erase clipboard history/synced copies anyway. The export is still materialized
in memory for the legacy metadata client; that server route now has explicit list
limits. A separate streamed domain archive and Android validation/encrypted-staging/
explicit-save source now exist. Flutter/bridge/provider/live SQL/device verification
remains open under B-18; executed JVM-stage checks are narrower, not device proof.
See ../api/account-archive.md and ../mobile/account-archive.md.
English catalog entries use the existing localization fallback; new translations
are not claimed.

Four widget tests were authored: no implicit writes on open/close, acknowledgement
without copying, exact explicit-copy data, revoked acknowledgement, and platform
failure/retry. These are NOT RUN (Flutter SDK unavailable). All changed Dart files
have syntax-only WASM parsing; that is not Flutter compilation, widget/device or
clipboard integration evidence.

## Commands actually executed

- `cd backend && ./node_modules/.bin/vitest run tests/unit/rate-limiter.test.ts tests/unit/logger-redaction.test.ts tests/unit/sensitive-actions.test.ts`: PASS, 19 targeted tests / 3 files.
- `npm --prefix backend run typecheck:tests`: PASS.
- `npm --prefix backend run test:unit`: PASS, 213 tests / 24 files.
- `npm --prefix backend run openapi:generate`: PASS; 400/403/429/503 contracts updated.
- `node scripts/check-dart-syntax.mjs /home/user/tooling/node_modules/@wasm-fmt/dart_fmt/dart_fmt_node.js`: PASS, 26 changed Dart files; syntax only.
- Final full safe gate outcomes and raw evidence are regenerated in checks.json;
  previous delivery's 202-unit / 24-Dart counts are historical, not current.

No new destructive cleanup, migrations, deployment, credentials, permissions,
platform enforcement capability or product-policy thresholds were introduced.
