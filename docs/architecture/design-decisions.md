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
