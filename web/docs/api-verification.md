# API verification — web client vs backend runtime

Everything below was verified by reading the backend source
(`backend/src/features/**/{routes,controller,service,validation,dto,types}.ts`,
`core/middleware/*`, `core/http/envelope.ts`) — not only `docs/api/openapi.yaml`.
The OpenAPI document diverges from the runtime in the places marked **GAP**.

## Envelopes & conventions (verified)

| Topic                  | Runtime behaviour                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Success responses      | Raw DTOs / shapes (controllers never use `successResponse`)                                               |
| Error responses        | `{ success:false, error:{ code, message, requestId, details? } }`                                         |
| Validation details     | `details: [{ field, code, message }]` (Zod `issue.path.join('.')`, `root` if empty)                       |
| Auth                   | `Authorization: Bearer <access token>` on every non-public route                                          |
| Idempotency            | `Idempotency-Key` **UUID** required on `POST /money/transactions` and `POST /money/subscriptions/:id/pay` |
| Optimistic concurrency | `version` in PATCH bodies; mismatch → `409 VERSION_CONFLICT`                                              |
| Pagination variants    | see per-domain tables (NOT uniform)                                                                       |
| Content type           | JSON enforced;100 KB body limit; global IP rate limit120/60s; per-user limits per feature                 |
| CORS                   | Not configured — browser client is same-origin only (relative `/api/v1` + rewrite)                        |
| `/health`              | Unversioned, outside `/api/v1`                                                                            |

## Auth (`/api/v1/auth`)

| Endpoint                | Runtime notes                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `POST /register`        | → `{ user, tokens }`. Password: ≥10 chars, ≤72 bytes, deny-list — **no complexity rule** (GAP if OpenAPI implies one) |
| `POST /login`           | → `{ user, tokens }`                                                                                                  |
| `POST /refresh`         | body `{ refreshToken }` → Tokens DTO **only** (no `expiresInSeconds` — GAP vs OpenAPI)                                |
| `POST /logout`          | Not route-authenticated; body `refreshToken` and/or Bearer;204                                                        |
| `POST /logout-all`      | authenticated; revokes **all** sessions incl. current + push devices; **204**                                         |
| `POST /forgot-password` | **202** empty body (timing-equalised)                                                                                 |
| `POST /reset-password`  | 204-style empty success                                                                                               |
| `POST /change-password` | authenticated; `{currentPassword,newPassword}` strict; **204**                                                        |

Expiry separation: access-token expiry arrives as error code `TOKEN_EXPIRED`;
revocation as `UNAUTHENTICATED` (client refreshes only for the former).

## Users (`/api/v1/users`)

| Endpoint                                    | Runtime notes                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /me`                                   | `{ user }`                                                                                                                                                                           |
| `PATCH /me`                                 | strict schema; `weekStart` **1..7**; `defaultCurrency` `/^[A-Z]{3}$/`                                                                                                                |
| `POST /me/deletion`                         | → **200** `{ status:'pending_deletion', deletionScheduledFor }` — grace period **14 days** (**GAP**: OpenAPI says 30)                                                                |
| `DELETE /me/deletion`                       | cancel →200 `{ status }`                                                                                                                                                             |
| `POST /me/export`                           | **POST** (**GAP**: OpenAPI/naive reading says GET) → `UserExportData` = profile, sessions, categories, pushDevices only (**GAP**: no tasks/projects/money/notes/habits/goals/events) |
| `PUT /me/devices`, `DELETE /me/devices/:id` | exist, but push-device registration is **not** performed from the browser                                                                                                            |
| `GET /me/deletion-status`                   | **does not exist** (**GAP**) — after a reload only `user.status` is knowable                                                                                                         |

Pending-deletion blocking: while `status='pending_deletion'` every request is
rejected (`ACCOUNT_PENDING_DELETION`) except: `POST /auth/logout`,
`POST /auth/refresh`, `GET /users/me`, `DELETE /users/me/deletion`,
`POST /users/me/export`.

## Tasks / Projects / Recurring / Timer

| Domain          | List shape                      | Notes                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks           | `{ data, meta:{ nextCursor } }` | filters: status CSV, priority CSV, projectId, `dueFrom`/`dueTo` (not exact `dueDate`), `plannedDate`, `overdue`, `isFocus`, completed range, sort/order, limit1–100. Task list DTO **omits `trackedSeconds`** (GAP if OpenAPI includes it). Delete: soft (restore endpoint exists) |
| Projects        | `{ data, meta }`                | `DELETE ?cascade=true` deletes task links too;500 if open tasks exist without cascade                                                                                                                                                                                              |
| Recurring tasks | `{ data, meta }`                | weekly → `recurrence.byWeekday` (ISO1–7); `daysOfWeek[0]` invalid; `interval≥2` invalid for daily                                                                                                                                                                                  |
| Timer sessions  | `{ data, meta }`                | `GET /active` → `{ timerSession: … \| null }`; start201; stop **200**; delete **204**; `TIMER_ALREADY_RUNNING` / `TIMER_NOT_RUNNING` codes                                                                                                                                         |

## Habits (`/api/v1/habits`)

- List `{ data, meta }` with runtime-only query fields `{ status, limit, cursor }`
  (GAP: OpenAPI documents different list filters).
- `GET /progress/today` (**no `date` parameter — verified live**; the server
  resolves "today" from the authenticated user's timezone) →
  `{ progress: { totalScheduled, done, skipped, percent } }` where `percent`
  is **already 0–100**, computed server-side as
  `done ÷ (scheduled − skipped)` (FR-HAB-06). **GAP**: the OpenAPI document
  describes a different shape (`date`, `totalDone`, `completionRate`,
  per-habit `habits[]`); the runtime wins and the client follows the runtime.
  Because the list DTO and this endpoint expose **no per-habit today status**,
  each habit card resolves its own state via
  `GET /:id/checkins?from=<today>&to=<today>` (N+1 bounded by list limit —
  documented limitation, all queries invalidated together under `['habits']`).
- Check-ins: `PUT /:id/checkins/:date` body `{ status: 'done'|'skipped', note? }`;
  `GET /:id/checkins` requires **`from` + `to`** (GAP: OpenAPI shows optional).
- Recurrence built client-side as `{ freq:'daily'|'weekly', interval?, byWeekday? }`;
  `weekly` without `byWeekday` →400. Streaks are computed **by the server**.

## Calendar events

- List `{ events }` with optional `from`/`to` **instant** filters (RFC3339);
  `GET /agenda?date=YYYY-MM-DD` → `{ date, totalEvents, events }`;
  `GET /conflicts?startAt&endAt[&eventId]` → `{ hasConflict, conflicts }`.
- All-day: send `startAt`/`endAt` as `<date>T00:00:00.000Z` (Zod `.datetime()`).
- Reminders CRUD: channels `push|in_app|email` (browser only creates `in_app`).

## Goals

- List `{ goals }` (unpaginated — GAP if OpenAPI shows cursor paging).
- `progressPercentage` and numeric progress math are **server-computed**;
  numeric goals accept `currentValue` (decimal string) with `version`.

## Notes

- List `{ notes }` — **unpaginated**, items are excerpts (no body);
  `GET /:id` returns full `{ note }`. Query: `q` (search) + exact filters only —
  **no general search endpoint** for other domains.
- `GET /tags` → `{ tags }`. Links CRUD under `/:id/links` (entity types
  task/project/goal/habit/event). Delete is soft (restore exists).

## Money (`/api/v1/money`)

| Endpoint      | Shape / notes                                                                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Categories    | `{ categories }` unpaginated; DELETE archives (un-archive via PATCH `archived:false` + version)                                                                                                                                  |
| Transactions  | `{ transactions, meta:{ limit, hasMore, nextCursor } }`; POST **requires Idempotency-Key UUID**; hard delete (204, no restore)                                                                                                   |
| Subscriptions | `{ subscriptions, meta }`; server computes `monthlyEquivalent`, `daysUntilNextBilling`, next-billing cycle math; `PATCH` statuses active/paused/cancelled; `POST /:id/pay` **Idempotency-Key** → `{ transaction, subscription }` |
| Budgets       | `{ budgets }` unpaginated with `usage` (`spent/remaining/percentUsed/overspent`); `GET /:id` **does not exist** (GAP); uniqueness per category+currency →409; PATCH accepts `amountLimit`+`version` only                         |
| Reports       | `GET /reports/summary?from&to[&currency&groupBy]` → raw `ReportSummaryDto` (`totals`, `byCategory[]`, optional `series[]`, all amounts decimal strings); span ≤366 days                                                          |

All monetary values are decimal **strings**; per-currency exponents
(0/2/3 decimals) live in `money.dto.ts` and are mirrored in
`src/lib/money/format.ts`.

## OpenAPI-vs-runtime gap summary

1. Deletion grace period: **14 days** (OpenAPI:30).
2. Export endpoint is **POST** and its payload **excludes** tasks/projects/
   money/notes/habits/goals/events.
3. No **GET deletion-status** endpoint exists.
4. `GET /money/budgets/:id` does not exist.
5. Refresh response has **no `expiresInSeconds`**.
6. Task list DTO omits **`trackedSeconds`**; task list has `dueFrom`/`dueTo`,
   not exact `dueDate`.
7. Habits list filters and `checkins from/to` differ from OpenAPI; **`GET
/habits/progress/today` takes no `date` and returns
   `{ totalScheduled, done, skipped, percent(0–100) }`** — not the OpenAPI
   `{ date, totalDone, completionRate, habits[] }` (client follows runtime;
   per-habit today state comes from `GET /:id/checkins?from&to`).
8. Pagination is heterogeneous: `{data,meta}` (tasks/projects/recurring/timer/
   habits) vs full `{limit,hasMore,nextCursor}` (transactions/subscriptions) vs
   unpaginated arrays/objects (notes, goals, events, categories, budgets).
9. `successResponse` helper is unused — success bodies are raw.
10. Forgot-password is `202`; change-password/logout-all are `204`.

Client behaviour on gaps: each one is either implemented per the runtime or
the feature is marked unavailable — nothing was fabricated.
