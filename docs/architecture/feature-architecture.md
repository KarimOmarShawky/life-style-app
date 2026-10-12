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

---

## 3. BYOK Architecture (approved pilot)

"Bring Your Own Key" means an **independent provider account and key on the user's
side** — not a shared key, not a prepaid in-app balance. Full design and pilot
program: `docs/testing/real-money-scenarios/BYOK_ARCHITECTURE_AND_PILOT_PLAN.md`.
Summary of the standing rules:

1. **Provider**: Gemini-only for the pilot. Multi-provider abstraction waits for
   a real second provider.
2. **Isolation**: one user == one key == one provider account; per-request
   presentation only. Quota exhaustion or billing failure of one user must never
   affect another.
3. **Keys & clients**: a user's key never reaches the client, the logs, or the
   APK. `env.GEMINI_API_KEY` remains the dev/test override only.
4. **Lifecycle**: graceful degradation first (standardized
   `SMS_FALLBACK_UNAVAILABLE` / assistant-unavailable paths), then self-disable
   with a clear message when the user's provider key keeps failing.
5. **Pilot**: fixed 14-day trial per user (not consumed-balance). Success is
   measured by zero key leakage, zero cross-user mixing, and a clean
   enable→use→disable lifecycle.
