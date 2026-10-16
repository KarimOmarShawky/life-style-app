# Container Architecture & Docker Guide

> **Specification Reference:** Section 19.4

## 1. Multi-Stage Dockerfile (`docker/Dockerfile`)

The container image is built using a multi-stage process to minimize image attack surface and eliminate build-time tools from the final runtime image:

* **Stage 1 (Builder):** Uses `node:24-alpine`, installs native build tools only in the disposable builder stage, installs dependencies via `npm ci`, compiles TypeScript (`npm run build`), and prunes devDependencies (`npm prune --omit=dev`).
* **Stage 2 (Runner):** Minimal `node:24-alpine` footprint, runs as unprivileged user `node`, copies only production artifacts (`dist/` and production `node_modules/`), and defines an active `HEALTHCHECK` probing `GET /health/live` with Node's built-in fetch.
* **Single Image, Multiple Targets:**
  * API Process: `node dist/server.js` (default)
  * Worker Process: `node dist/worker.js` (via container command override)

---

## 2. Local Docker Compose (`docker/docker-compose.yml`)

The local compose file spins up the complete development topology:
* `postgres`: PostgreSQL 16 on port 5432 with healthchecks and persistent volume `postgres_data`.
* `redis`: Redis 7 on port 6379 with AOF enabled and persistent volume `redis_data`.
* `mailpit`: Mailpit SMTP server (port 1025) and Web UI (port 8025).
* `api`: LifeStyle Express API server on port 3000.
* `worker`: Background job worker.

### Fresh-local setup only

From repository root, follow [private setup and existing-install safeguards](../development/local-setup.md):

```bash
node scripts/local-setup.mjs --fresh-install
node scripts/local-stack.mjs --check
# Only for a confirmed fresh installation after successful configuration review:
node scripts/local-stack.mjs --start
```

Generation never starts services or changes existing passwords. Both Compose sources
require the generated parameters; the wrapper explicitly pins the random project,
private env file, root file and local Docker socket. Use only that reviewed scope
for any operator logs/stop command; unscoped legacy commands can target another
stack. Never publish resolved Compose/inspect output or delete volumes to repair
an existing installation. Actual Compose/role execution remains BLOCKED here.

## Mandatory migration gate (2026-10-15)
Use the root compose file from the repository root. Its one-shot migration service
must exit successfully before API or worker startup; the image now ships `.cjs`
migrations. See [database migration and recovery runbook](../database/migrations.md).
Never run `docker compose down -v` to repair an existing installation.

The maintenance worker remains mandatory for reminders, recurring generation, timer
cleanup and purges. Password-reset delivery no longer depends on it: reset secrets
stay in API memory and are sent via bounded synchronous SMTP. Production SMTP uses
TLS with certificate verification (implicit TLS on 465 or required STARTTLS), optional
configured EMAIL_USER/EMAIL_PASSWORD auth, and timeouts. Failed delivery rejects with
a generic error; it is never recorded as success. External SMTP delivery is unverified.
After upgrading, treat legacy `email` queue payloads/backups as potentially sensitive;
restrict Redis access and securely expire old infrastructure snapshots according to
retention policy. New code neither creates nor consumes legacy plaintext reset jobs.
Restarting workers from the old image can still consume them: do not mix revisions.
