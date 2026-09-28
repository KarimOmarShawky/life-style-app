# Input Validation & Injection Prevention

> **Specification Reference:** Section 16.4 & ADR-007

## 1. Zod as Single Source of Validation Truth

Every API endpoint defines strict Zod schemas for:
* `params`: URL path parameters (e.g. UUID verification)
* `query`: URL query string parameters (filtering, pagination cursor, limit)
* `body`: Request payload

### Validation Rules
* **Strict Objects:** All schemas invoke `.strict()` to reject mass-assignment of unknown fields (such as client-supplied `userId`, `role`, or `createdAt`).
* **Trimming:** String inputs are automatically trimmed.
* **Length Bounds:** Explicit minimum and maximum lengths on text fields prevent application-layer memory exhaustion.
* **Money String Formatting:** Monetary values are validated using regex strings (`/^-?\d+(\.\d{1,4})?$/`) and rejected if non-numeric or exceeding four decimal places.

---

## 2. SQL Injection Prevention

* **Typed Query Building:** All SQL queries are constructed using Kysely. Kysely parameterizes all dynamic inputs into PostgreSQL positional placeholders (`$1`, `$2`).
* **Ban on Unsanitized Raw SQL:** Use of `sql.raw` with direct variable interpolation is strictly prohibited by coding standards and ESLint rules.
* **Sort & Filter Whitelisting:** Column names for sorting and filtering map through explicit internal TypeScript enums and never use user-supplied strings directly.
