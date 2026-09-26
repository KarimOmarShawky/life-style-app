# Development setup

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 or newer | 22 is what this was built on |
| npm | 10 or newer | Ships with Node |
| PostgreSQL | 14 or newer | A hosted instance such as Neon works and needs no local install |
| MongoDB | 6 or newer | Optional locally. Notes and the audit log are unavailable without it |
| Redis | 6 or newer | Optional locally. Rate limiting falls back to per-process counters |

Only PostgreSQL is required to run and test the backend.

## Steps

```bash
cd backend
npm ci                  # installs from the lockfile
cp .env.example .env    # then fill it in, see below
npm run migrate         # creates the schema
npm run dev             # starts on http://localhost:3000
```

Verify:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/readiness
```

Readiness reports each dependency as `up`, `down` or `not_configured`.

## Generating secrets

`JWT_SECRET` and `JWT_REFRESH_SECRET` must each be at least 32 characters, must
differ from each other, and must not start with a placeholder word. The
application refuses to start otherwise.

```bash
openssl rand -base64 48
```

Run it twice and use different values for each.

## Running without MongoDB or Redis

Leave `MONGODB_URI` and `REDIS_URL` empty. The application starts and logs a
warning for each. What changes:

| Missing | Effect |
|---|---|
| MongoDB | Note endpoints answer 503. Audit entries go to the structured log instead of the collection. Everything else works |
| Redis | No caching. Rate limits become per-process. Logout cannot revoke an already-issued access token before it expires |

Both become mandatory when `NODE_ENV=production`, enforced at startup.

### What this costs in the test suite

Without `MONGODB_URI`, the note integration and security suites **skip**, and
`notes-unavailable.test.ts` runs in their place to prove the degraded behaviour.
The run is green and reports the skips; it is not silently reduced coverage.

**You do not need a MongoDB to get those suites run.** CI starts PostgreSQL 16,
MongoDB 7 and Redis 7 as service containers on every push, so the full suite
executes there on GitHub's machines at no cost in local bandwidth. Check a run
with `gh run list`, or the Actions tab.

To exercise the MongoDB paths locally as well, point `MONGODB_URI` at any MongoDB
and run `npm test` again. A free Atlas cluster is enough, and the connection
string is the only thing needed:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/lifestyle?retryWrites=true&w=majority
```

The suites create their own data under a per-run prefix and delete it afterwards,
including the notes, which are removed before their PostgreSQL users because
nothing cascades across the boundary.

If `MONGODB_URI` is set but unreachable, those suites RUN and FAIL rather than
skipping. That is deliberate: a configured database that is down is a broken
environment, not a reason to report green.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Start with hot reload |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | Type check without emitting |
| `npm run lint` | ESLint |
| `npm run format` | Prettier, writing changes |
| `npm run migrate` | Apply pending migrations |
| `npm run migrate:status` | Show applied, pending and modified migrations |
| `npm test` | Every test |
| `npm run test:unit` | Unit tests only. No .env, no database, no network |
| `npm run test:integration` | Integration tests, needs PostgreSQL |
| `npm run test:security` | Security tests, needs PostgreSQL |
| `npm run audit` | Dependency vulnerabilities at high or above |

The unit tier uses its own Vitest config with no setup file, so it cannot
acquire a database dependency by accident. If `npm run test:unit` ever starts
needing an environment variable, something has been added to the wrong tier.

## API documentation

With the server running in development, Swagger UI is at
`http://localhost:3000/docs`, and the raw document at `/docs/openapi.json`.

It is not mounted in production. Publishing the full API surface is free
reconnaissance; enable it there deliberately and behind authentication.

## About the test database

Integration and security tests run against the **same** PostgreSQL instance as
development, not an isolated one. Isolation comes from a unique email prefix per
run, cleaned up afterwards by a `DELETE` that cascades.

Two rules follow:

- Never add a test that asserts on a global count.
- Never `TRUNCATE` in a test.

Both would destroy development data. In CI, point `DATABASE_URL` at a throwaway
database or a Neon branch and the restriction disappears.

## Writing a migration

1. Create `NNN_description.sql` in
   `backend/src/infrastructure/database/postgres/migrations/`, numbered after the
   last one.
2. Write plain SQL. It runs inside a transaction.
3. `npm run migrate`.

Never edit a migration that has already been applied. The runner stores a
checksum per file and refuses to continue if one changes, because the database no
longer matches the file and every other environment would drift. Write a new
forward migration instead.

## Troubleshooting

**`Invalid environment configuration`** lists every problem at once. Fix them all
and restart.

**`role "<user>" does not exist`** from a local PostgreSQL means no database role
matches your operating-system user:

```bash
sudo -u postgres createuser -s "$USER"
sudo -u postgres createdb lifestyle_dev
```

**Migration says a file was modified.** An applied migration was edited. Restore
the original content, or if the change is genuinely needed, write a new migration.

**`OverwriteModelError`** means a Mongoose model was registered twice in one
process. Models guard against this already; a new model must follow the same
pattern.

**Every refresh returns 401.** Check the clock. Token expiry is absolute time, so
a badly skewed system clock invalidates tokens immediately.
