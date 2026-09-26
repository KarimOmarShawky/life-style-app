# Troubleshooting

Problems that have actually happened on this project, with the signature that
identifies each one. Ordered by how easily the symptom is mistaken for something
else.

## Note endpoints return 503, everything else works

**This is the degradation working, not a bug.** MongoDB is unreachable and only
notes and the audit log depend on it. The API stays up by design.

Check the startup log for `MongoDB unavailable at startup; continuing in
degraded mode`, then look at the error underneath it.

**`tlsv1 alert internal error` / `SSL alert number 80`, with every shard listed
as `Unknown`.** The SRV record resolved, so DNS and the cluster name are right.
Atlas is refusing the connection at the TLS handshake because the client IP is
not on the access list — it kills the handshake rather than answering cleanly,
which is why this does not look like an authentication failure.

Fix it in Atlas under **Network Access**, not in the connection string. A home IP
is usually dynamic, so `0.0.0.0/0` is the practical setting; the cluster is
protected by its password, not by the network.

**Anything mentioning authentication.** Then it is the credentials, and the
username in the URI is the place to start.

## Notes are written to a database called `test`

The connection string has no database in its path. Mongoose defaults a missing
database name to `test`, silently. The path segment goes before the `?`:

```
mongodb+srv://user:pass@cluster0.example.mongodb.net/lifestyle?retryWrites=true
```

## The process exits immediately and logs no request

Configuration validation. Every problem is reported at once, with the variable
name and the reason, and never the value — the value is usually the secret.

The two that are easy to miss because they are *conditional*:

- `MONGODB_URI` and `REDIS_URL` are optional in development and required when
  `NODE_ENV=production`.
- `CORS_ALLOWED_ORIGINS` must be non-empty in production.

And the one that produces no error at all: forgetting `NODE_ENV=production`
does not fail. The application starts in development mode, which means refresh
cookies without `secure`, Swagger UI mounted publicly at `/docs`, and none of
the three requirements above enforced.

## Migrations report `applied: 0, skipped: 0` against an empty database

The build shipped a migration runner with no migrations. `tsc` emits JavaScript
and nothing else, so the `.sql` files have to be copied separately —
`scripts/copy-migrations.mjs` does that and fails the build if it cannot, but a
build produced before that script existed has the problem.

Rebuild and confirm: `find dist -name '*.sql' | wc -l` should print the number of
files in `src/infrastructure/database/postgres/migrations/`.

This one is dangerous because every line of it looks like success: the runner
exits 0 and the server starts normally, against a database with no tables.

## Migrations hang

The runner takes a session-level advisory lock so that two instances starting at
once cannot apply the same file twice. Two causes:

1. Another instance holds it and is still running. Wait.
2. `DATABASE_URL` points at Neon's `-pooler` endpoint. PgBouncer's transaction
   pooling does not preserve session state, so the lock is released immediately
   and protects nothing — and in the worst case the runner waits on a lock it
   will never observe. Use the direct endpoint: the same hostname with `-pooler`
   removed.

## Editing a migration that has already run is rejected

Deliberate. Every applied file's checksum is recorded, and a file that no longer
matches its checksum means the database and the repository have diverged — in
this environment and every other one.

There is no `down` step, also deliberately: a generated rollback that silently
drops a column is more dangerous than not having one. Write a new numbered
forward migration.

## A slow query warning for `SELECT 1` at startup

Neon suspends an idle compute and resumes it on the next connection. The first
query after a quiet period pays that resume, and 1900 ms for `SELECT 1` is a cold
start, not a slow database.

## Every test in a file reports as "skipped", and the file reports FAIL

A `beforeAll` hook threw or timed out, so Vitest never ran the tests. The real
error is in the failed-suites section at the end, not next to the skipped tests.

Seen here when six workers opened six MongoDB handshakes at once and one exceeded
the server-selection budget: that fork degraded, every note endpoint in it
answered 503, and an entire security suite failed for a reason that had nothing
to do with notes. The test tier raises
`MONGODB_SERVER_SELECTION_TIMEOUT_MS` for this reason; the application default
stays low, because a live request should fail fast rather than hang.

## `npm test` reports exit code 0 while tests are failing

Only when it is piped. `npm test | tail -30` reports `tail`'s status, not the
suite's. Redirect instead, and check the code:

```bash
npm test > run.log 2>&1; echo "exit=$?"
```

This has produced a confident "CI is green" here more than once.

## Tests pass individually and fail in a full run

Almost always a shared resource rather than a defect in the feature. The suites
are written for concurrency — `TEST_PREFIX` contains the process id, cleanup is
scoped to that prefix, and `test/setup.ts` forbids asserting on global counts and
forbids TRUNCATE — so suspect connection limits, a per-connection timeout, or a
rate limiter before suspecting the code under test.

## Everything is slow, and nothing changed

Check where the database is. The API and its database should be in the same
region or adjacent ones: moving this project's PostgreSQL from `eu-central-1` to
`us-east-2` made an identical set of six migrations 2.2x slower, and every query
of every request pays that.
