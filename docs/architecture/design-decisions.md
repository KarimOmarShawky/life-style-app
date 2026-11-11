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

### ADR-044: Approved Scope Amendments — SMS Auto-Capture, Server-Side LLM Fallback, Multi-Language UI, Optional-Task Focus Timer (Retroactive, 2026-10-11)
* **Context:** These capabilities were built and shipped before this record existed. The post-implementation audit (2026-10) flagged them as silent reversals of the R1 exclusions in §2.2/§5.3 and of the English-only UI lock, with no approval trail. The product owner reviewed the audit findings and **approved them retroactively** (decision (b): retrospectively approve) on 2026-10-11.
* **Decision (supersedes the matching exclusions in `deferred-and-non-goals.md` and the English-only lock):**
  1. **Android SMS auto-capture (opt-in)** is approved scope. Raw SMS never leaves the phone; messages are sanitized on-device (OTP/phone/account/reference/URL/email/balance/fee/date/percent/promo redaction) before any network use, and re-sanitized server-side. Capture requires an explicit user switch and `RECEIVE_SMS` permission.
  2. **Server-side LLM (Gemini) fallback for unrecognized wallet SMS** is approved scope. The API key lives only in backend env (`SMS_FALLBACK_GEMINI_KEY`), never in a mobile build. Only sanitized text is sent; model output is validated against a strict transaction schema and re-sanitized. High-confidence results may auto-save (user requirement, stated in the implementation brief); low-confidence results always require user confirmation in the Money review flow.
  3. **Arabic/RTL + multi-language catalogs (ar/de/es/fr/tr)** are approved scope. MVP UI is no longer locked to English-only.
  4. **Focus Timer sessions without a task** are approved scope (optional task link). TimerSession→Task is optional.
* **Guardrails (standing):** No raw SMS in logs or third-party payloads; the mobile AI chat assistant and the SMS fallback may not send financial data beyond the sanitized transaction schema; ADR-039's dependency guard remains (no AI/ML SDK packages — the fallback calls the Gemini HTTPS API directly).
* **Consequences:** `deferred-and-non-goals.md` keeps only what is genuinely excluded (see its "Scope amendments" section). The earlier lock rows are retired rather than contradicted in place.

### ADR-045: First-Party, Content-Free Product Events (Feature Guide G5, 2026-11-10)
* **Context:** Activation and D1/D7/D30 retention could not be measured, so no impact claim was possible. The owner approved G5 on 2026-11-10 with the recommended design.
* **Decision:** A first-party `product_events` table, written only through the authenticated, strictly validated and rate-limited `POST /api/v1/product-events`. A row carries the event name (closed list of six), server time, the user's local day, platform and app version — nothing else. One row per user, event and local day. Accounts can opt out (`users.product_events_enabled`; opting out deletes their events). Events are included in the account metadata export, erased with the account, excluded from the v1 archive file as a documented exclusion, and deleted after 400 days. `PRODUCT_EVENTS_ENABLED` is the kill switch.
* **Guardrails:** No third-party analytics SDK, no device identifiers, no titles or free text, no client timestamps. Adding an event name or column requires a new migration and an owner privacy review. Definitions live in `docs/analytics/product-events.md`.
* **Consequences:** Production needs the owner-run SQL (`docs/analytics/sql/product-events-and-onboarding.sql`) because the production database has no migration ledger; the API degrades safely until then.

### ADR-046: One Notification Policy — Quiet Hours, Daily Limit, Summary, Tiers (Feature Guide G2, 2026-11-11)
* **Context:** Reminders had no quiet hours, daily limit, summary or master switch, and every timed task rang as an insistent full-screen alarm (Phase 0 finding P0-F3). The app never declared `USE_FULL_SCREEN_INTENT` (which Google Play also restricts to alarm and calling apps on Android 14+), so that alarm was in practice a heads-up banner that rang until dismissed. Server push (E3) must not ship without a policy (guide risk "Push without G2: hard gate").
* **Decision:** One pure policy function with four outcomes: allow, delay (out of quiet hours), digest (joins that local day's single summary notification) and drop. It exists in TypeScript (`backend/src/features/notifications/notification-policy.ts`) for the worker's push path and in Dart for the device scheduler; both must pass the shared cases in `mobile-app/mobile/test/fixtures/notification_policy_cases.json`. Tiers: **Critical** = an alarm the user chose; **Normal** = task and calendar reminders; **Low** = nudges and summaries. Preferences are stored per account (`notifications_enabled`, quiet start/end, daily limit, digest, critical-breaks-quiet) and reuse `users.timezone`.
* **Owner decisions (2026-11-11):** quiet hours are off until the user turns them on (22:00–07:00 suggested); a timed task gets a normal notification and rings as an alarm only when the user chooses that for the task; there is no daily limit until the user sets one, and notifications over the limit join one summary notification instead of being lost. Critical notifications break quiet hours only by opt-in (guide rule).
* **Rules:** the master switch off drops everything, including alarms. Quiet hours use the account's local wall clock, include the start minute, exclude the end minute and may cross midnight. A quiet end inside a daylight-saving gap moves forward by the gap; in a repeated hour, the first occurrence after the notification wins. The limit counts non-critical notifications per local day of delivery. A day's summary arrives at its first item's time, moved out of quiet hours, and is never limited. Unknown time zones fall back to UTC. The policy never sees notification text.
* **Exempt:** notifications that belong to a session the user is running right now (focus-timer phase changes, the Focus Shield status). They are a direct result of a user action and end with the session.
* **Consequences:** a forward-only migration plus owner-run SQL for the preference columns, because production has no migration ledger; the API must degrade safely until it is applied. Push stays unavailable (`PUSH_UNAVAILABLE`); when E3 lands, the worker must consult the policy before sending, enforced by a test.

### ADR-047: Signed-in Devices — List Sessions and Sign Out One (Feature Guide G6, 2026-11-11)
* **Context:** `auth_sessions` already stored each session's device platform, name, app version, creation and last-use times, but a user could only sign out this device or every device (`logout-all`). Seeing and ending one session becomes more urgent once push reaches several devices (E3). Guide §8.3; the owner approved G6 on 2026-11-11.
* **Decision:** `GET /api/v1/sessions` lists the account's active sessions (not revoked, not past `absolute_expires_at`), the calling session first and marked `current`, at most 50 (`truncated` says if more exist). `POST /api/v1/sessions/{id}/revoke` checks the current password, then in one transaction locks the session row, sets `revoked_at` and `revoked_reason = 'user_revoked'`, revokes that session's refresh tokens and deletes the push devices it registered. Signing out the calling session is allowed; the app then finishes a normal logout.
* **Invariants:** refresh tokens stay opaque and are stored only as SHA-256 hashes; this API never reads them. Ownership always comes from the authenticated session: another account's session id is answered exactly like an unknown id (404 `NOT_FOUND`, ADR-038), never 403. ADR-041 reuse detection is unchanged (the refresh path was not modified); a refresh that loses a race against a revoke is rejected because the session is revoked. Responses carry device metadata only: never `created_ip`, a token or a hash. Repeating a revoke answers 200 again.
* **Limits:** 30 requests per 60 s per user on both routes. Revoking also spends the shared, fail-closed re-authentication budget (5 per 15 minutes per account, with change-password, account deletion and export); malformed requests are rejected before the budget is spent.
* **Schema:** forward-only migration `1792770000000_auth_sessions_user_revoked` widens the `revoked_reason` CHECK list; production gets the same statements from `docs/auth/sql/auth-sessions-user-revoked.sql` (owner-run). Until then the database rejects the new value and the session is revoked with `logout` instead (same effect), remembered for 10 minutes so the failing statement is not retried on every request.
* **Not changed:** the JSON export still lists session metadata without `created_ip`; the versioned v1 archive file still contains the account's own `created_ip` values (owner decision pending). Accounts in the deletion grace period cannot list sessions (scheduling deletion already signs out the other devices).

## 2026-10-15 implementation clarification (R-22)
Voice dictation exists in the current application using platform speech recognition.
ADR-044 did not explicitly authorize voice, and this note does not invent retroactive
owner approval. The native Gemini transcription branch was unreachable because its key reader
returned empty. The 2026-10-16 cleanup removed those dead provider/recording branches,
kept OS speech input and legacy notification compatibility, and removed unused app
microphone capabilities. Native compilation/device verification and confirmation of
remaining voice policy scope are still required; no guaranteed offline speech is claimed. Digital Detox is explicitly authorized by the current task;
its actual supported scope is documented in `docs/mobile/digital-detox.md`.


## 2026-10-15 owner clarification: local audio versus server uploads (ADR-039 / D-08)
The owner explicitly clarified that the file prohibition concerns uploads to the
server to avoid leaks, not selecting a local sound for Focus Timer. Preserve the
existing audio-only selection/playback. No server uploads, new picker consumers or
general file/image storage are approved. The guard permits only the reviewed mobile
manifest/lock entries and existing audio-only consumer, not a global package allowlist.
The earlier guard's ADR-008 file-storage label was inaccurate: ADR-008 above is UUIDs.
See `../security/local-audio-boundary.md` for enforcement, negative tests, current-flow
review and remaining native/network verification limits. No blanket no-leak guarantee.
