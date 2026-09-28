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
