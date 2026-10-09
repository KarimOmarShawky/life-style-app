# Deferred Features & Non-Goals

> **Specification Reference:** Section 2.2, 5.3 & ADR-001, ADR-039

The following capabilities are **explicitly excluded** from the MVP (Release Phase R1) boundary. They are not implemented, not deployed, not documented as features, and guarded against by automated CI checks (ADR-039):

| Category | Excluded Feature / Technology | Justification & Architectural Policy |
| :--- | :--- | :--- |
| **Databases** | MongoDB | PostgreSQL is the sole relational source of truth for MVP. MongoDB is excluded until R3 (AI memories or raw ingested messages). |
| **Authentication** | Cookies & CSRF | Client is Flutter native mobile (iOS/Android). Bearer tokens in secure platform storage eliminate browser cookie attack surfaces. |
| **Permissions** | RBAC / Roles | LifeStyle App is a single-user personal operating system. Authorization is strictly ownership-based (`user_id`). |
| **Storage** | File / Image Uploads | MVP handles text, dates, numbers, and structured data. General blob storage is deferred. |
| **AI / ML** | LLMs, Natural Language Parsing | Core habits, task schedules, and financials are built deterministically. AI is deferred to R3. |
| **Integrations** | SMS & Email Auto-Ingestion | SMS auto-capture is implemented for Android (opt-in, with a session-bound ingest token). Email auto-ingestion remains deferred to R3. Other transactions are logged explicitly. |
| **Synchronization**| Offline-First Sync Engines | Local offline databases (Drift, SQLite, Hive) are deferred to R4. MVP provides bounded client caching with live REST updates. |
| **Client Platforms**| Web Client & Desktop | MVP targets native iOS and Android. Web interfaces are non-goals. |
| **UI Scaffolding** | RTL / Arabic Layouts | Multi-language localization scaffolding is included from day one, but MVP UI is locked to English-only (ADR-043). |
