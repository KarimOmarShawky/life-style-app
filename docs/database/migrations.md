# Database Migrations Architecture

> **Specification Reference:** Section 6.12 & ADR-006

## 1. Migration Tooling

* **Tool:** `node-pg-migrate`
* **Format:** Plain SQL or CommonJS migration files with explicit `up` and working `down` handlers.
* **Location:** `backend/src/infrastructure/database/postgres/migrations/`
* **Execution Role:** Executed exclusively with the `lifestyle_migrator` role. The API server NEVER runs migrations at application startup.

---

## 2. CI Verification & Reversibility Check

Every pull request runs an automated reversibility test in CI:
```bash
npm run migrate:up
npm run migrate:down
npm run migrate:up
```

If any migration fails to apply or roll back cleanly on an empty database, CI fails and merge is blocked.

---

## 3. Migration Commands

```bash
# Apply pending forward migrations
DATABASE_MIGRATION_URL="postgresql://lifestyle_migrator:pass@localhost:5432/lifestyle_dev" npm run migrate:up

# Roll back the most recent migration
DATABASE_MIGRATION_URL="postgresql://lifestyle_migrator:pass@localhost:5432/lifestyle_dev" npm run migrate:down

# Create a new reversible migration file
npm run migrate:create -- my-migration-name
```
