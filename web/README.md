# LifeStyle Web Client

Next.js (App Router) frontend for the LifeStyle backend. This directory is the
complete web application: it consumes **only** the existing backend API — no
backend or mobile code was changed, no endpoints were invented, and no
production data is mocked.

> **Status note.** The repository's `docs/deferred-and-non-goals.md` marks a web
> client as a non-goal; this build is produced on explicit instruction and
> supersedes that document for `web/`.

## Stack

| Concern         | Choice                                                        |
| --------------- | ------------------------------------------------------------- |
| Framework       | Next.js 15 (App Router), React 19, TypeScript strict          |
| Styling         | Tailwind CSS 4 + shadcn/ui-style components, Lucide icons     |
| Data fetching   | TanStack Query (relative `/api/v1/...` URLs only)             |
| Forms           | React Hook Form + Zod (schemas mirror backend validation)     |
| Money           | decimal strings end-to-end, `decimal.js` for all arithmetic   |
| Tests           | Vitest (unit/component/integration/security) + HTTP e2e smoke |
| Package manager | npm with committed `package-lock.json`, Node ≥ 24 target      |

## Security model (fixed decisions)

- **Tokens live in memory only** (a per-tab closure inside `AuthProvider`).
  Nothing is written to cookies, `localStorage`, `sessionStorage`,
  IndexedDB, URLs, or logs. A page reload intentionally requires signing in
  again.
- **Relative API URLs.** Browser code only ever calls `/api/v1/...`. The
  Next.js server rewrites them to the server-only `BACKEND_INTERNAL_URL`
  environment variable (never `NEXT_PUBLIC_*`, never a host literal in client
  code). Without that variable the proxy fails closed (requests404 instead of
  leaking anywhere).
  > `rewrites()` is evaluated at **build time** — set `BACKEND_INTERNAL_URL`
  > when running `next build`, not only at `next start`.
- **Single-flight refresh** only on an explicit `TOKEN_EXPIRED` error code,
  exactly one retry per request. Any refresh failure (including uncertain
  rotation outcomes) clears the token pair and ends the session. A plain
  `UNAUTHENTICATED` never refreshes — it ends the session immediately.
- **No redirect following** on authenticated fetches (`redirect: 'manual'`),
  so bearer credentials can never reach another destination.
- **Production headers** (middleware): CSP with per-request nonce +
  `strict-dynamic` (no `unsafe-eval`), `frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri 'self'`, `connect-src 'self'`,
  `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `Permissions-Policy`,
  HSTS only over HTTPS in production. Because the CSP is nonce-based, all
  routes are rendered per request (`force-dynamic`) so nonces are injected
  into every `<script>` tag.
- **No `dangerouslySetInnerHTML` anywhere.** Notes and descriptions render as
  plain text. No analytics, third-party scripts, remote fonts, or external
  hosts.
- Errors shown to users come from a safe message catalog — stacks, SQL,
  request bodies, and tokens are never displayed. Timeouts (15 s) surface as
  retryable network errors.

## Getting started

```bash
cd web
npm ci                     # install with the committed lockfile

# Development (server-side proxy target must be reachable by the Next server)
cp .env.example .env.local  # then edit BACKEND_INTERNAL_URL
npm run dev

# Production build + serve
BACKEND_INTERNAL_URL=https://internal-api.example npm run build
npm run start
```

`.env.local` / `BACKEND_INTERNAL_URL` is server-only. There is intentionally no
`NEXT_PUBLIC_*` backend configuration.

## Scripts

| Script                       | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `npm run dev`                | Development server                                            |
| `npm run build` / `start`    | Production build / serve                                      |
| `npm run typecheck`          | `tsc --noEmit` (strict)                                       |
| `npm run lint`               | ESLint                                                        |
| `npm run format:check`       | Prettier check (CI) / `format` writes                         |
| `npm test`                   | All Vitest suites (unit, components, integration, security)   |
| `npm run e2e`                | HTTP smoke against the real production build (+ mock backend) |
| `npm run verify`             | format:check → lint → typecheck → test → build                |
| `npm run generate:api-types` | Regenerate `src/types/openapi.generated.ts`                   |

## Structure

```
web/src/
  app/(auth)/        login, register, forgot-password, reset-password
  app/(workspace)/   today (/), tasks, projects, recurring-tasks, focus,
                     habits, goals, calendar, notes,
                     money/{categories,transactions,subscriptions,budgets,reports},
                     settings
  components/        app-shell, navigation, forms, feedback, data-display, ui
  features/          one module per domain (api/hooks/schemas/view)
  lib/               api (client, errors), auth (session, provider), config,
                     date, money, validation
  providers/         query, toast, app composition
  styles/, types/, middleware.ts (security headers)
web/tests/
  unit/ components/ integration/ security/ e2e/ fixtures/
web/docs/api-verification.md    verified contract + OpenAPI gaps
```

Deep links are registered centrally in `src/lib/config/routes.ts` (also used
by the guard and tests to guarantee every required screen has a route).

## Tests

- **Unit** — error-envelope parsing and safe messages, money formatting
  (decimal-string exactness, currency exponents), date handling (date-only
  values never shift, DST-aware zone conversions), deep links /
  open-redirect sanitising, validation schemas, refresh single-flight.
- **Component** — auth guard states, button/dialog/error states, focus &
  confirmation flows.
- **Integration** — real views driven through TanStack Query against
  DTO-derived fixtures: task list/toggle/pagination/delete, login redirect
  safety, transaction creation with `Idempotency-Key` + string amounts,
  `VERSION_CONFLICT` explanation without overwrite.
- **Security** — no storage writes, token transport rules (header-only, never
  URLs), `redirect: 'manual'`, refresh only on `TOKEN_EXPIRED`, no credential
  logging, middleware header matrix.
- **E2E HTTP smoke** (`npm run e2e`) — builds the production bundle (with
  `BACKEND_INTERNAL_URL` set), boots `next start` beside a throwaway mock
  backend, and asserts header/nonce/proxy behaviour over the wire.

## CI

`web-gate` in `.github/workflows/ci.yml` runs format → lint → typecheck →
tests → production build → e2e smoke → `npm audit --omit=dev` on Node 24.
The existing `backend-gate` job is untouched.

## Known limitations & assumptions

- **Reload ⇒ re-sign-in** is by design (memory-only tokens).
- The backend export endpoint only returns profile, sessions, categories, and
  push devices — tasks, projects, money, notes, habits, goals, and events are
  not included (documented in Settings and in `docs/api-verification.md`).
- No `GET` endpoint exists for deletion status; after a reload the scheduled
  deletion _date_ cannot be re-read (only `user.status`), so the Settings
  banner says so explicitly.
- Push notifications are not registered from the browser (no defined browser
  behaviour in the repo).
- Subscription cycle math, streaks, budget usage, and report totals are
  displayed exactly as the server computes them — never re-derived client-side.
- No hosting or production deployment workflow is chosen here; deployment
  docs must document `BACKEND_INTERNAL_URL` at build time.
