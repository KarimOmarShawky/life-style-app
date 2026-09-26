# Git Workflow & Pull Request Process

> **Specification Reference:** Section 19.3 & 21

## 1. Branching Strategy

* `main`: Protected production-ready branch. Direct pushes to `main` are disabled.
* `feature/<phase>-<description>`: Topic branches created from `main`.

---

## 2. Commit & Implementation Loop

Every phase and feature follows the authoritative implementation cycle:
```text
Implement → Test → Security Review → Documentation → Verify → Commit → Continue
```

### Commit Message Conventions
Use conventional commits:
* `feat(p1): implement central error handling and response envelope`
* `test(p1): add integration tests for health endpoints`
* `docs(p1): add backend architecture and layering documentation`
* `security(p1): enforce Helmet JSON API security headers`

---

## 3. Pull Request Requirements & CI Gates

Every pull request must pass the automated GitHub Actions pipeline before merge approval:
1. ADR-039 Forbidden-dependency check passes.
2. `npm ci` installs cleanly with locked dependencies.
3. ESLint and Prettier checks pass with zero errors.
4. `tsc --noEmit` compiles with zero errors under strict mode.
5. All unit, integration, and security tests pass.
6. Database migration reversibility check (`up -> down -> up`) passes on an empty database.
7. OpenAPI document is synchronized with Zod schemas (`openapi.yaml` diff is clean).
8. `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities.
