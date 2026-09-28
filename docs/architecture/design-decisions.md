# Architecture Decision Records (ADRs)

> **Specification Reference:** Section 22 (ADR-001 through ADR-044)

This record captures the fundamental architectural decisions governing the LifeStyle App codebase:

### ADR-001: PostgreSQL Only for Business Data; MongoDB Deferred
* **Decision:** All MVP data lives in PostgreSQL 16. MongoDB is not deployed.
* **Reason:** All domain entities are strongly relational, interconnected, and require transactional integrity.
* **Alternatives:** MongoDB for notes; hybrid database deployment.
* **Trade-offs:** Adoption later requires a deliberate synchronization strategy (§5.3). Zero cross-store consistency issues now.

### ADR-002: Opaque, Hashed, Rotating Refresh Tokens
* **Decision:** Refresh tokens are 256-bit cryptographically secure random values stored as SHA-256 hashes, rotated on every use with reuse detection.
* **Reason:** Server-side state is required for revocation anyway; opaque tokens cannot be forged or inspected.
* **Alternatives:** JWT refresh tokens with JTI denylists.
* **Trade-offs:** Every token refresh hits PostgreSQL.

### ADR-003: Bearer Tokens in Platform Secure Storage for Mobile
* **Decision:** Flutter stores tokens in iOS Keychain / Android Keystore and sends `Authorization: Bearer <token>`. The server sets zero cookies.
* **Reason:** Native mobile apps do not run in a browser context. Eliminates CSRF attack surface entirely.
* **Alternatives:** HTTP-only cookies with CSRF tokens.

### ADR-004: Ownership-Based Authorization; No RBAC in MVP
* **Decision:** Access is granted strictly by resource ownership (`user_id`). No roles or permissions tables.
* **Reason:** Single-user personal app has no collaborative roles to enforce.
* **Alternatives:** Roles table with user/admin roles.

### ADR-005: Composite Foreign Keys `(id, user_id)` for Ownership Consistency
* **Decision:** Parent tables enforce `UNIQUE (id, user_id)`. Child tables reference both columns.
* **Reason:** The database itself physically prevents cross-user relational linkage, providing defense-in-depth against IDOR/BOLA.

### ADR-006: Kysely Query Builder & Node-PG-Migrate
* **Decision:** Typed SQL query building via Kysely over `pg`; reversible plain-SQL migrations via `node-pg-migrate`.
* **Reason:** Strong compile-time typing without hiding relational SQL. Full access to partial indexes and `FOR UPDATE SKIP LOCKED`.

### ADR-007: Zod Single Source of Truth
* **Decision:** Single Zod schema per endpoint driving runtime validation, TypeScript static types, and generated OpenAPI documentation.
* **Reason:** Eliminates drift between implementation and documentation.

### ADR-008: UUID Primary Keys
* **Decision:** Standard UUIDv4 primary keys via `gen_random_uuid()`.
* **Reason:** Non-enumerable, collision-safe, sync-friendly.

### ADR-009: Money as `numeric(19,4)` and Decimal Strings
* **Decision:** Zero IEEE 754 floating point arithmetic. Handled via `decimal.js` on server, `Decimal` in Dart, and transported strictly as decimal strings.

### ADR-021: Manual Constructor Injection Composition Root
* **Decision:** `src/container.ts` wires all interfaces to implementations explicitly without a runtime DI framework.

### ADR-022: Structured Logging with Pino and AsyncLocalStorage
* **Decision:** High-performance JSON logging with request context propagation across asynchronous boundaries. Strict automated redaction.

### ADR-039: Forbidden-Dependency CI Guard
* **Decision:** Automated CI script (`scripts/check-forbidden.mjs`) fails builds if MongoDB, cookie parsers, file upload SDKs, AI, or offline sync tools appear.

### ADR-041: Strict Refresh-Token Reuse Detection with No Grace Window
* **Decision:** A rotated or raced refresh token immediately revokes the entire user session. No timing-based exceptions.
