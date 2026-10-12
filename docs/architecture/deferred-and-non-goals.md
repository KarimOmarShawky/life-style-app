# Deferred Features & Non-Goals

> **Specification Reference:** Section 2.2, 5.3 & ADR-001, ADR-039

The following capabilities are **explicitly excluded** from the MVP (Release Phase R1) boundary. They are not implemented, not deployed, not documented as features, and guarded against by automated CI checks (ADR-039):

| Category | Excluded Feature / Technology | Justification & Architectural Policy |
| :--- | :--- | :--- |
| **Databases** | MongoDB | PostgreSQL is the sole relational source of truth for MVP. MongoDB is excluded until R3 (AI memories or raw ingested messages). |
| **Authentication** | Cookies & CSRF | Client is Flutter native mobile (iOS/Android). Bearer tokens in secure platform storage eliminate browser cookie attack surfaces. |
| **Permissions** | RBAC / Roles | LifeStyle App is a single-user personal operating system. Authorization is strictly ownership-based (`user_id`). |
| **Storage** | File / Image Uploads | MVP handles text, dates, numbers, and structured data. General blob storage is deferred. |
| **AI / ML** | General LLM features | Core habits, task schedules, and financials are built deterministically. General LLM features are deferred to R3. The two approved exceptions (wallet SMS fallback, AI assistant) are defined in ADR-044 and must stay inside their guardrails. |
| **Integrations** | Email auto-ingestion | Email auto-ingestion is deferred to R3. Wallet SMS auto-capture is approved scope per ADR-044. Other transactions are logged explicitly. |
| **Synchronization**| Offline-First Sync Engines | Local offline databases (Drift, SQLite, Hive) are deferred to R4. MVP provides bounded client caching with live REST updates. |
| **Client Platforms**| Web Client & Desktop | MVP targets native iOS and Android. Web interfaces are non-goals. |
| **UI** | Web/desktop UI chrome | Native mobile UI only. Multi-language localization (`en`, `ar`, `de`, `es`, `fr`, `tr`, `zh`, `ja`, `ru`, `hi`, `pt`) and RTL are approved scope per ADR-044. |

## Scope amendments (approved 2026-10-11 — ADR-044)

The product owner retroactively approved the following scope expansions after the
post-implementation audit (2026-10). They **supersede** the earlier R1 exclusions
for these items specifically; the table above lists only what remains excluded.

| Approved capability | Reverses | Standing guardrails |
| :--- | :--- | :--- |
| Android SMS auto-capture (opt-in, session-bound ingest token) | R1 "SMS & Email Auto-Ingestion" exclusion (SMS half) | Raw SMS never leaves the phone; sanitization on device and server; explicit user switch + `RECEIVE_SMS` |
| Server-side Gemini fallback for unrecognized wallet SMS | R1 "AI / ML" exclusion (this use only) | Key in backend env only (`SMS_FALLBACK_GEMINI_KEY`); sanitized text only; strict schema; high may auto-save, low always confirms |
| Mobile AI assistant (chat) | R1 "AI / ML" exclusion (this use only) | Release builds disable compile-time keys (`kReleaseMode`); dev/test override or BYOK pilot only (`BYOK_ARCHITECTURE_AND_PILOT_PLAN.md`) |
| Multi-language & RTL catalogs (`en`, `ar`, `de`, `es`, `fr`, `tr`, `zh`, `ja`, `ru`, `hi`, `pt`) | English-only UI lock | Standard Flutter localization and RTL layout rules |
| Focus Timer sessions without a task | TimerSession-must-belong-to-a-Task lock | Task link is optional, not removed |
| Backend query surfaces (`/dashboard`, `/days/:date`, `/search`) | Mobile-first parity assumption | Active and tested in backend API (`P1-05`); mobile navigation shell focuses on the 9 domain tabs |
