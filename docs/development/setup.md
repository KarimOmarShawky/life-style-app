# Local Development Environment Setup

> **Specification Reference:** Section 19.4 & 20.2

This guide walks a developer through setting up the LifeStyle App backend foundation from scratch.

## 1. Prerequisites

* **Node.js:** Active LTS (v20.x+)
* **npm:** v10.x+
* **PostgreSQL:** v16.x or v17.x
* **Redis:** v7.x or v8.x
* **Mailpit:** Local SMTP capture tool

---

## 2. Installation Steps

### Step 1: Clone and Install
```bash
git clone <repo-url> lifestyle
cd lifestyle/backend
npm ci
```

### Step 2: Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `REDIS_URL`, and JWT/OTP secrets are defined.

### Step 3: Initialize Database Roles
Run the initial database setup script against PostgreSQL as superuser:
```bash
psql -d postgres -c "CREATE DATABASE lifestyle_dev;"
psql -d lifestyle_dev -f src/infrastructure/database/postgres/init-roles.sql
```

### Step 4: Run Migrations
Apply database migrations using the migrator role:
```bash
npm run migrate:up
```

### Step 5: Start API and Worker
In separate terminal sessions:
```bash
# Terminal 1: API Server
npm run dev

# Terminal 2: Worker Process
npm run dev:worker
```

### Step 6: Verify Health Probes
```bash
curl -i http://localhost:3000/health/live
# Expected: HTTP 200 {"status": "ok"}

curl -i http://localhost:3000/health/ready
# Expected: HTTP 200 {"status": "ok"}
```
