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

### Running Docker Compose
```bash
# Start all services in the background
docker compose -f docker/docker-compose.yml up -d

# View live API logs
docker compose -f docker/docker-compose.yml logs -f api

# Shut down services and preserve volumes
docker compose -f docker/docker-compose.yml down
```
