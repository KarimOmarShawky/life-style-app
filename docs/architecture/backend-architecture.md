# Backend Architecture & Strict Layering

> **Specification Reference:** Section 4.3–4.6 & ADR-021

## 1. Strict Layering Architecture

Every request travels strictly in one direction through six architectural boundaries:

```text
Route → Middleware → Controller → Service → Repository → PostgreSQL
```

### Layer Rules & Invariants

| Layer | Permitted Actions | Strictly Forbidden |
| :--- | :--- | :--- |
| **Route** | Declares HTTP method, URL path, middleware order (`rateLimit → authenticate → validate`) | Any business rules, input mutations, direct handler logic |
| **Middleware** | Cross-cutting concerns: Request ID, headers, body size checks, auth, Zod validation | Business logic, direct database queries |
| **Controller** | Reads validated input, calls exactly one Service method, returns response envelope | Direct database access, business rules |
| **Service** | Core business rules, ownership checks, transactions (`TransactionRunner`), audit logging | Express `req`/`res` imports, SQL string authoring |
| **Repository** | SQL execution via Kysely; every method receives `userId` first | Business decisions, cross-user unscoped queries |
| **DTO Mapper** | Explicit mapping between database rows and API response schemas | Exposing raw database rows or password hashes |

---

## 2. Request Lifecycle & Flow

```mermaid
flowchart TD
    A[Incoming Request] --> B[requestId + AsyncLocalStorage Context]
    B --> C[Security Headers + 100 KB Body Limit + JSON Content-Type Check]
    C --> D[Global IP Rate Limit]
    D --> E[Route-Specific Rate Limit]
    E --> F[Authenticate: Verify JWT, Check Session in PG - Phase P2]
    F --> G[Validate: Zod on Params, Query, Body]
    G --> H[Controller]
    H --> I[Service: Ownership, Rules, TransactionRunner]
    I --> J[Repository: Kysely User-Scoped SQL]
    J --> K[DTO Mapper]
    K --> L[Envelope: success: true]

    F -. Failure .-> X[AppError]
    G -. Failure .-> X
    I -. Failure .-> X
    J -. DB Error .-> X
    X --> Y[Global Error Handler: Safe Masking & JSON Error Envelope]
```

---

## 3. Dependency Inversion & Composition Root (ADR-021)

All application components depend strictly on abstract interfaces rather than concrete implementations:
* `Clock` $\rightarrow$ `SystemClock` (production) or `FakeClock` (testing).
* `IdGenerator` $\rightarrow$ `UuidGenerator`.
* `RateLimiter` $\rightarrow$ `RedisRateLimiter` (production) or `MemoryRateLimiter` (testing).
* `TransactionRunner` $\rightarrow$ `PgTransactionRunner`.
* `SessionValidator` $\rightarrow$ `PgSessionValidator`.

All wiring is declared explicitly in `src/container.ts` using manual constructor injection without runtime DI containers.
