# Coding Standards & Guidelines

> **Specification Reference:** Section 0.5, 4.3 & 16.4

## 1. TypeScript & Language Standards

* **Strict Mode:** `strict: true`, `noImplicitAny: true`, `exactOptionalPropertyTypes: true` are enabled in `tsconfig.json`.
* **No `any` Policy:** Explicit `any` is strictly banned by ESLint. Use typed generics, `unknown`, or domain models.
* **ES Modules:** All backend code is written using native Node.js ES Modules (`import`/`export` with `.js` extensions in imports).
* **Code Formatting:** Automated with Prettier (single quotes, no trailing commas, 100 print width, 2 spaces indentation).

---

## 2. Layering Invariants

* **Route:** Must only declare HTTP paths, methods, and the strict sequence of middleware.
* **Middleware:** Handles request context, headers, authentication, and Zod schema validation.
* **Controller:** Unpacks validated request data, calls a single service method, and returns the standardized response envelope. Controllers must never write SQL or make business decisions.
* **Service:** Implements business invariants, ownership authorization, transaction orchestration (`TransactionRunner`), and after-commit side effects. Services must never import Express types (`Request`, `Response`).
* **Repository:** Executes parameterized queries using Kysely. Every method accepts `userId` as its first parameter and filters by it.

---

## 3. SQL & Data Access Rules

* **Parameterized Queries Only:** All queries must use Kysely query builders with bound parameters.
* **Banned `sql.raw` with Input:** Raw string concatenation into SQL is strictly forbidden to prevent SQL injection.
* **Never Catch-All Ignore Errors:** Errors must be mapped to appropriate `AppError` subclasses.
