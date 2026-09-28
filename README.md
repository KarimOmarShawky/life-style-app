# LifeStyle App — Personal Life Operating System

> **Specification Reference:** LifeStyle App — Final Technical & Product Specification v1.0.1  
> **Current Build Phase:** **P1 — Backend Foundation** (COMPLETE)

LifeStyle App is a personal life operating system structured around the core loop:  
**PLAN → FOCUS → DO → TRACK → REVIEW**

The application answers the single life question:  
*"What should I focus on today, and how is the rest of my life progressing?"*

---

## 1. System Architecture & Foundation (Phase P1)

* **Runtime:** Node.js Active LTS (v20+) with TypeScript 5 (Strict Mode).
* **Framework:** Express 5.
* **Source of Truth:** PostgreSQL 16 (relational data store, least-privilege roles, composite ownership foreign keys, ACID transactions).
* **Infrastructure State:** Redis 7 (used strictly for rate limiting, OTP tokens, and BullMQ queues).
* **Security & Hardening:** JSON-only API, Helmet HTTP headers, CSP (`default-src 'none'`), `X-Request-Id` propagation, Pino structured logging with AsyncLocalStorage and automated redaction, centralized error mapper, and ADR-039 forbidden-dependency CI guard.
* **Client Architecture:** Flutter (iOS & Android) communicating over HTTPS with Bearer token authentication (no browser cookies, no web client).

---

## 2. Directory Structure

```text
lifestyle/
├── backend/                  # Node.js + Express + TypeScript service
│   ├── src/
│   │   ├── config/           # Environment schema (Zod) & validation
│   │   ├── core/             # Errors, logger, middleware, security, time, money
│   │   ├── infrastructure/   # PostgreSQL pool, Kysely, TransactionRunner, Redis
│   │   ├── features/         # Feature modules (Health in P1; Auth/Entities in P2+)
│   │   ├── container.ts      # Manual DI composition root (ADR-021)
│   │   ├── app.ts            # Express application assembler
│   │   ├── server.ts         # API entry point & graceful shutdown
│   │   └── worker.ts         # Background worker entry point
│   └── tests/                # Unit, integration, and security test suites
├── mobile/                   # Flutter mobile client scaffolding
├── docs/                     # Authoritative engineering documentation
│   ├── architecture/         # System diagrams, layer rules, ADR log, non-goals
│   ├── database/             # PostgreSQL schema, database roles, migrations, Redis
│   ├── development/          # Setup, coding standards, git workflow, testing guide
│   ├── deployment/           # Docker, environment variables, health checks, CI/CD
│   ├── api/                  # Conventions, error contract, OpenAPI document
│   └── security/             # Threat model, input validation, HTTP hardening
├── docker/                   # Multi-stage Dockerfile and docker-compose.yml
└── scripts/                  # ADR-039 forbidden-dependency guard & tooling
```

---

## 3. Quick Start & Local Setup

### Prerequisites
* Node.js `>= 20.0.0`
* PostgreSQL `>= 16.0`
* Redis `>= 7.0`
* Mailpit (for local SMTP testing)

### Installation & Initialization
1. **Clone repository and install dependencies:**
   ```bash
   cd backend
   npm ci
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your local PostgreSQL and Redis credentials
   ```

3. **Initialize database roles (run once as postgres superuser):**
   ```bash
   psql -d lifestyle_dev -f src/infrastructure/database/postgres/init-roles.sql
   ```

4. **Run database migrations:**
   ```bash
   npm run migrate:up
   ```

5. **Start API server:**
   ```bash
   npm run dev
   ```

6. **Start Background worker:**
   ```bash
   npm run dev:worker
   ```

7. **Verify health probes:**
   ```bash
   curl -i http://localhost:3000/health/live
   curl -i http://localhost:3000/health/ready
   ```

---

## 4. Running Verification & Quality Gates

```bash
# Run ADR-039 Forbidden-Dependency Guard
npm run check:forbidden

# Run type check (strict TypeScript)
npm run --prefix backend typecheck

# Run linter & code formatter check
npm run --prefix backend lint
npm run --prefix backend format:check

# Run full test suite (unit, integration, security)
npm run --prefix backend test
```

---

## 5. Documentation Index

* [System Architecture Overview](docs/architecture/overview.md)
* [Backend Architecture & Layering](docs/architecture/backend-architecture.md)
* [Design Decisions (ADR Log)](docs/architecture/design-decisions.md)
* [Deferred & Non-Goals](docs/architecture/deferred-and-non-goals.md)
* [Database Architecture & Roles](docs/database/database-overview.md)
* [Security Overview & Threat Model](docs/security/security-overview.md)
* [API Conventions & Error Envelope](docs/api/conventions.md)
* [Docker & Compose Guide](docs/deployment/docker.md)
* [CI/CD Pipeline](docs/deployment/ci-cd.md)
