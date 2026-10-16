# Testing Strategy & Guidelines

> **Specification Reference:** Section 19.1 & 19.2

Testing is a core quality gate and is mandatory across all implementation phases.

## 1. Test Architecture

The test suite is organized into three distinct tiers:
1. **Unit Tests (`backend/tests/unit/`):** Test domain logic, date math, monetary operations, cursor codecs, error factories, and configuration validation in isolation.
2. **Integration Tests (`backend/tests/integration/`):** Test API endpoints, middleware pipelines, database connection pools, transactions, and health checks against live PostgreSQL and Redis services.
3. **Security Tests (`backend/tests/security/`):** Specifically verify security invariants, absence of cookies, header protections, and prevention of information leakage.

---

## 2. Test Execution Commands

```bash
# Run the complete test suite
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run only security tests
npm run test:security

# Run tests with test coverage reporting
npm run test:coverage
```

---

## 3. Test Invariants

* **Deterministic Clock:** Time-dependent business logic must use `FakeClock` to prevent flaky tests.
* **Deterministic IDs:** Tests use seeded or fixed UUIDs where appropriate.
* **Database Isolation:** Integration tests operate within isolated schemas or transactions.
* **Zero Leakage Assertion:** Security tests verify that response bodies under error conditions never expose stack traces, database schema names, table structures, or secrets.

## Destructive test isolation gate (2026-10-15)
`npm --prefix backend run test:unit` needs no database; its defaults use inert port 1.
Integration/security setup refuses to import test files unless all are explicit:
- `ALLOW_DESTRUCTIVE_TESTS=isolated-resources-only`
- `DATABASE_URL` names `lifestyle_test` or `lifestyle_test_<suffix>`
- `REDIS_URL` names a dedicated nonzero Redis database (1–15).
These are safeguards, not proof that a remote endpoint is disposable. The operator
must verify service identity and ensure no application shares those resources.
CI provides ephemeral PostgreSQL/Redis containers and dedicated database names.
Do not point tests at development/staging/production; they DELETE users and FLUSHDB.

## Reviewed helper entry points (2026-10-15)
- `bash scripts/ensure-env.sh --check` is now configuration-only. Supply explicit
  DATABASE_URL, DATABASE_MIGRATION_URL and REDIS_URL via a trusted environment
  manager. It does not source .env, install packages, start services or apply DDL.
- `bash scripts/verify-ci.sh` defaults to quality/unit/build/audit. It still enforces
  the existing forbidden-dependency guard; do not describe it as passing while
  file_picker remains unresolved.
- `bash scripts/verify-ci.sh --isolated` additionally requires the existing
  destructive-test acknowledgement and explicit matching disposable test targets.
  It checks identities before migrations/tests and runs up/repeat-up, never down.
  Target names and an acknowledgement are not proof of resource ownership: verify
  isolation out of band before executing. No development/staging/live cleanup.
- Standalone helper tests: `node --test scripts/check-environment.test.mjs` uses
  npm/service command spies, not a real database or real migration success.
See `docs/remediation/secret-triage.md` for the 18 reviewed credential patterns and
why 16 retained local/CI defaults remain a failing source-secret gate.


## Fresh-local configuration tests (not infrastructure proof)
Run `node --test scripts/check-environment.test.mjs scripts/local-setup.test.mjs`
from repository root. C26 covers 17 existing helper/source tests; C27 adds 22 tests
using owned temporary directories, real local-generator child processes, a fake
GitHub environment file and Docker command spies. No real service is contacted.
These tests do not verify SQL syntax/runtime, Compose interpolation, hosted masking,
container health, grants, migrations or data preservation on a real database.

See [fresh-local setup](local-setup.md) for the separate opt-in generator. Its
`lifestyle_dev` targets and Redis zero are NOT destructive-test resources; isolation
guards must continue refusing them. Never use generated local settings to bypass
explicit dedicated-test ownership and resource checks.


## Dedicated hosted runtime gate and streamed domain archive
`.github/workflows/isolated-runtime.yml` is an additional PR/manual workflow, not
permission to ignore the existing failing file_picker or mobile/policy gates. It
uses fresh GitHub-hosted PostgreSQL 16/Redis 7 service containers. Before bootstrap,
`ci-resource-guard.mjs` checks the explicit isolated targets and the actual service
IDs, running image identities, local mapped ports, test database and common job
network using captured local-socket Docker inspection (never printed). GitHub
service IDs must come directly from the job context; flags/IDs are not authentication
for arbitrary local callers. The guard itself does not mutate services.

The job then initializes fresh roles, runs forward migrations twice, verifies that
existing-role bootstrap refuses, and runs integration/security suites. No down
migration, environment dump, secret-bearing artifact upload or external DB is used.
The public ephemeral CI administrator fixture remains; application credentials are
masked and generated per job. Hosted execution has NOT RUN here. Populated legacy
upgrade/fault-recovery, Docker Compose topology and device verification remain
separate BLOCKED gates, not covered by this authored workflow.

C28 runs 16 negative/command-spy/source guard tests locally; these are not physical
container-isolation proof. Backend archive units use SQL/HTTP/response spies. Two
new PostgreSQL archive tests and a users-flow deletion-grace archive case are
**authored but BLOCKED**, never included in a passing unit count. They must only run
in verified disposable services: normal integration invocation still refuses
before importing destructive fixtures without explicit isolated-resource settings.
See `../api/account-archive.md` for scope, limits, completion validation and native
implementation still required.
