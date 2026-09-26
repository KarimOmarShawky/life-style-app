# Feature Architecture & Isolation

> **Specification Reference:** Section 4.2 & 4.3

## 1. Feature Folder Structure

Every functional domain is encapsulated within a self-contained feature folder under `backend/src/features/<feature>/`:

```text
tasks/
├── tasks.routes.ts          # Route definitions & middleware chain order
├── tasks.controller.ts      # HTTP adapter: input unpack -> service call -> envelope
├── tasks.service.ts         # Business logic, ownership checks, transactions
├── tasks.repository.ts      # Repository interface (TaskRepository)
├── tasks.repository.pg.ts   # Kysely PostgreSQL implementation
├── tasks.validation.ts      # Zod validation schemas (feeds runtime & OpenAPI)
├── tasks.dto.ts             # Explicit row-to-DTO transformers
├── tasks.types.ts           # Internal domain types
├── tasks.reader.ts          # Read-only interface for cross-feature queries
└── __tests__/               # Feature-specific unit and integration tests
```

---

## 2. Cross-Feature Isolation Rules

1. **No Direct Table Queries:** A feature module must NEVER directly query tables belonging to another feature.
2. **Read Composition via Reader Interfaces:** Query features (such as `day`, `dashboard`, `search`, and `export`) depend strictly on read-only `Reader` interfaces (`TaskReader`, `HabitReader`, `MoneyReader`).
3. **Write Orchestration via Services:** State mutations that affect another domain must call that domain's public `Service` interface.
4. **Zero Dependency Cycles:** Circular imports between features are strictly forbidden and guarded by `dependency-cruiser` in CI.
