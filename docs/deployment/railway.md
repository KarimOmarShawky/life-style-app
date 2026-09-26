# Deploying the API to Railway

The application is a stateless container. Everything it keeps lives in PostgreSQL,
MongoDB and Redis, so a deployment is: build an image, run the migrations, start
the process. There is nothing to back up on the instance itself and nothing is
lost by replacing it.

## Before the first deploy

**Region.** Set the service's region to `europe-west4` (Amsterdam). Railway
defaults to US West. The database is in `eu-central-1` (Frankfurt), and the
distance between the API and the database is paid on every query of every
request — measured at 2.2x on this project's own migrations when the database was
briefly in `us-east-2`. Amsterdam to Frankfurt is a few hundred kilometres; US
West to Frankfurt is not.

**Root directory.** Set it to `backend`. This repository will also hold a Flutter
app, and the image should not rebuild because a Dart file changed.

Railway then finds `backend/railway.toml` and `backend/Dockerfile` on its own.

## Environment variables

Set these in Railway's dashboard. Type them there directly — do not copy
`backend/.env` into a chat, a ticket or a commit. `.env.example` documents every
variable; these are the ones that are required or that differ in production.

These seven are required. The process refuses to start without any of them, and
every other variable in `.env.example` has a working default.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | The Neon **direct** endpoint, `sslmode=verify-full` |
| `MONGODB_URI` | Atlas connection string, including the `/lifestyle` database |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Generate on the server. `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | Generate separately. It must differ from `JWT_SECRET` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated origins. Never `*` |

Do **not** set `PORT`. Railway injects it and the application reads it; a fixed
value here is how a deployment ends up listening on a port nothing routes to.

`COOKIE_SECRET` is deliberately absent from that list. `cookie-parser` receives
it, but no cookie in this application is signed — the refresh cookie is
`httpOnly`, `secure` and `SameSite=strict`, which is what protects it — so
setting it changes nothing today. Set it when a signed cookie is introduced.

`LOG_PRETTY` is also absent: unset already means `false`. Setting it to `true` in
production crashes the process, because `pino-pretty` is a development
dependency and is not in the image.

Four of these are enforced at startup rather than trusted (`src/config/env.ts`):

- `MONGODB_URI` and `REDIS_URL` are optional in development and **required** in
  production. Without Redis every instance keeps its own rate-limit counters, so
  N instances multiply every limit by N.
- `CORS_ALLOWED_ORIGINS` is required in production. An empty value is refused, not
  defaulted to something permissive.
- `JWT_SECRET` and `JWT_REFRESH_SECRET` must differ. If they match, an access
  token verifies as a refresh token and a 15-minute credential becomes a 30-day
  session.

The process exits on any of these rather than starting in a broken state.

**Generate the production secrets on the server, not on a laptop.** They are
different secrets from the development ones, and the fewer places they exist, the
smaller the problem when one of those places leaks.

## What a deploy does

```
npm run migrate:prod && node dist/server.js
```

Migrations run before the server accepts traffic, so an instance never serves a
request against a schema it does not expect.

This is safe with several instances starting at once. The runner takes a
session-level advisory lock, so the second instance waits, then finds every
migration already applied and does nothing. That lock is also why `DATABASE_URL`
must be Neon's **direct** endpoint: PgBouncer's transaction pooling does not
preserve session state, and the lock would be released before it was any use.

Applied migrations are recorded with a checksum. Editing a migration that has
already run is rejected — the database no longer matches the file, and every
other environment would diverge. Changes go in a new numbered file.

## Health checks

Three endpoints, answering three different questions. They are not
interchangeable.

| Path | Question | Use |
|---|---|---|
| `/health` | Is the process up? | Cheap probe, touches nothing |
| `/liveness` | Should this container be restarted? | Process faults only |
| `/readiness` | Should traffic be routed here? | Dependencies checked |

Railway is pointed at `/readiness`. It returns 503 only when PostgreSQL is
unreachable; MongoDB or Redis being down returns 200 with `status: degraded`,
because those remove features rather than the service.

`/liveness` deliberately ignores the databases. If a failing database restarted
instances, every instance would restart-loop during a database incident and turn
a degradation into an outage.

## Rolling back

Redeploy the previous deployment from Railway's dashboard. The image is
immutable and the container holds no state.

**A schema change does not roll back with it.** There is no `down` step, by
design — a generated rollback that silently drops a column is more dangerous than
not having one. If a deploy fails *because* of a migration, the fix is a new
forward migration, not an attempt to reverse the old one.

## When a deploy fails

| Symptom | Cause |
|---|---|
| Exits immediately, no request logged | Configuration validation. The log names the variable |
| `Migrations complete, applied: 0` on a fresh database | The image is missing the `.sql` files. `npm run build` copies them and fails if it cannot; check the build stage |
| Health check times out, process running | `/readiness` returning 503: PostgreSQL unreachable. Check `DATABASE_URL` and Neon's state |
| Migration hangs | Another instance holds the advisory lock, or `DATABASE_URL` points at the `-pooler` endpoint |
| 503 from note endpoints only | MongoDB unreachable. The rest of the API is unaffected; this is the degradation working |
| Image build fails installing `bcrypt` | A native addon with no prebuilt binary for the base image. The Dockerfile uses Debian slim and installs a compiler for this reason; alpine's musl is the case most likely to lack a prebuild |
| Crashes at startup with a `pino-pretty` module error | `LOG_PRETTY=true` in production. `pino-pretty` is a development dependency and is not in the image. Production logs are JSON |

## What is not set up

- No custom domain. Railway's generated hostname is what exists
- No log aggregation. Logs are JSON on stdout and are read in Railway's dashboard
- No error tracking service
- No staging environment. Deployments go straight to production from `main`
- `/docs` (Swagger UI) is not mounted in production. Publishing the full surface
  of an API is free reconnaissance; enabling it there is a deliberate act, behind
  authentication. This is also why `docs/api/openapi.yaml` is not in the image
- The image has not been built locally. Docker is not installed on the machine
  this was written on, so the first real build happens on Railway
