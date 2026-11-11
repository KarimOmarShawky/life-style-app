# Hybrid AI — AI-0 audit, no code (2026-11-11)

> **Historical snapshot** — audit of `main` at `18d9172` (PR #31 merged) on branch
> `arena/04c63949-life-style-app`, 2026-11-11. Line numbers refer to that commit.
> No application code, migration, dependency or configuration was changed. This is a
> design and audit document, not an implementation report and not a release approval.

Source: `LifeStyle_Complete_Master_and_Hybrid_AI_Reference.pdf` (attached by the owner on
2026-11-11). Part I's AI-0…AI-6 sequence is authoritative; Part II is the engineering
companion. Path shorthand in this report: `be/` = `backend/src/`, `app/` =
`mobile-app/mobile/lib/`.

## 0. Owner inputs that shape this audit (2026-11-11)

- **AI is the owner's top product priority.** Per Part I §12.1 this selects the AI track
  over E3 after launch verification. E3 (FCM) waits until after AI-4 unless the owner
  says otherwise.
- **Google Play account: personal** (creation date not stated). Personal accounts created
  after 2023-11-13 need a closed test with at least 12 testers opted in for 14 continuous
  days before applying for production access, then a production-access review.
- **Consequence (recommendation, §8):** the closed test is private. Start it with the
  current build plus the pre-launch slice AI-P. Ship AI-1, AI-2 and AI-3 as closed-track
  updates during the 14 days. The public launch carries only AI slices whose tests and
  device checks passed.
- **Testers must use AI too** (owner, later on 2026-11-11). Google reviews the first
  closed-test release before testers receive it, so AI-P must be in that first build. AI
  must also be enabled on the production backend with a paid-tier Gemini key (owner
  action, §8).
- Part I asks for an explicit owner choice before AI implementation runs in parallel with
  launch verification. This audit treats AI-P as launch work (Play requires it, §3
  AI0-F2) and asks for that choice for AI-1 onward (decision D0).

## 1. Evidence executed for this audit

| Check | Where | Result |
| :--- | :--- | :--- |
| `npx vitest run tests/unit/ai-proxy.test.ts` | local, `18d9172` | **PASS**, 21/21 |
| Temporary tsx script calling `validateAiChatBody` with the body the app builds (whole history plus the new message); deleted after running | local, `18d9172` | 10 prior exchanges (21 turns): accepted. 11 (23 turns) and 50 (101 turns): `VALIDATION_ERROR` "messages must contain at most 21 turns". 7 replies of 3,500 characters (15 turns): `VALIDATION_ERROR` "messages must total at most 24000 characters" |
| Hosted CI on `18d9172` | run 43094570557 | Backend gate: success. Flutter format, analyze, tests and debug APK: success. The run ended `failure` on the APK artifact upload step only; the tree is identical to `594d24c`, which is green in 43093789279 |
| Flutter tests, device behaviour, production database | — | **NOT RUN** here |

## 2. Baseline verified against the specification

| # | Specification claim | Verdict | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | Server-side Gemini proxy, `POST /api/v1/ai/chat` and `/chat/stream` | Confirmed | `be/features/ai/ai.routes.ts:69-72`; `be/app.ts:289-290`; `be/docs/openapi-generator.ts:1510,1540` |
| 2 | `AI_ENABLED` kill switch; disabled AI answers 503 before any quota is charged | Confirmed | `be/config/env.ts:86-93`; `ai.routes.ts:38-49,69`; `be/container.ts:359-373` (warns when enabled without a key) |
| 3 | Per-user quotas | Confirmed: 10 per minute, 200 per day, bounded process-local fallback without Redis | `env.ts:95-96`; `ai.routes.ts:51-67` |
| 4 | Timeouts and streaming | Confirmed: 20 s upstream timeout, SSE, abort on client close, `[DONE]` terminator | `env.ts:97`; `be/features/ai/gemini-client.ts:67,112`; `ai.controller.ts:29-62` |
| 5 | No prompt or reply logging | Confirmed by reading: only the failure kind is logged | `be/features/ai/ai.service.ts:95-120`; `gemini-client.ts` header |
| 6 | Default model `gemini-3.5-flash-lite` | Confirmed | `env.ts:89` |
| 7 | `AiService` depends directly on `GeminiClient` | Confirmed: no provider interface or registry | `ai.service.ts` constructor; `container.ts:361-370` |
| 8 | Request: messages, language, mode | Confirmed. Limits: 21 turns, 4,000 characters per turn, 24,000 in total, language name at most 35 letters | `be/features/ai/ai.types.ts:23-43` |
| 9 | BYOK retired, key on the server only | Confirmed | `ai.types.ts` header; `container.ts:355-370` |
| 10 | Flutter `AiService` facade with prompt templates and a circuit breaker | Confirmed. 23 public methods, of which 6 are reachable from the UI (AI0-F4) | `app/features/ai/data/ai_service.dart` |
| 11 | Chat history local, SharedPreferences, at most 100 messages | Confirmed; a clear-chat control exists | `app/features/ai/data/chat_history_store.dart:13,36-38`; `app/features/ai/presentation/ai_assistant_screen.dart:225-231` |
| 12 | Egress consent held in memory only | Confirmed for the assistant: asked again on every new screen instance | `ai_assistant_screen.dart:23,91-111` |
| 13 | The client may send context JSON | **Partly.** `sendMessageWithContext` and `answerWithData` exist, but no screen calls them at `18d9172`: the risk is latent, not active | `ai_service.dart:212-232,305-325` |
| 14 | Six catalogues | Confirmed; 28 `ai*` getters | `app/l10n/app_localizations.dart` |
| 15 | Reusable domain services | Confirmed, each with `restore*` (recoverable deletes): tasks (create, get, update, delete, restore, list); goals (plus milestones); projects; habits (plus `recordCheckin`, `deleteCheckin`, `getCheckins`, `getTodayProgress`); notes (plus links and tags); calendar (plus `checkConflicts`, `getAgenda`, reminders) | `be/features/{tasks,goals,projects,habits,notes,calendar}/*.service.ts` |
| 16 | `users` holds locale and timezone | Confirmed: `timezone VARCHAR(64) DEFAULT 'UTC'`, `locale VARCHAR(16) DEFAULT 'en'` | `schema.sql:10-11` |
| 17 | Export and deletion are explicit flows | Confirmed. New owned tables follow the G5/G2 pattern: `OPTIONAL_USER_OWNED_TABLES`, `USER_OWNED_TABLES_IN_DELETE_ORDER`, `ACCOUNT_ARCHIVE_OWNED_EXCLUSIONS` (documented v1-archive exclusion, no version bump) | `be/features/users/users.repository.pg.ts:47-50,52-…,302`; `be/features/users/account-archive.sources.ts:127-131` |
| 18 | No AI memory tables | Confirmed: 16 migrations, latest `1792770000000_auth_sessions_user_revoked.cjs` | `be/infrastructure/database/postgres/migrations/` |
| 19 | Redis for temporary state | Confirmed: ioredis through `getRedisClient()`; atomic Lua precedent | `be/infrastructure/redis/redis-client.ts:15`; `be/core/security/otp-service.ts:27-49` |
| 20 | Existing AI regression guards | `scripts/ai-egress-regression.test.mjs`: streaming only through the backend proxy, consent keys in six catalogues, no provider-key entry point. Every slice must keep it green | `scripts/ai-egress-regression.test.mjs:11-40` |

## 3. Findings

| ID | Severity | Finding | Evidence | Proposed fix and slice |
| :--- | :--- | :--- | :--- | :--- |
| **AI0-F1** | **High** | **Long conversations break.** The app sends the whole on-screen conversation (up to 100 saved messages) on every send. The server accepts at most 21 turns and 24,000 characters. From the 12th message of a conversation, or sooner after a few long replies, every send fails with 400. The app shows its generic "unavailable" error, and because history is saved, the failure survives restarts until the user clears the chat. | `ai_assistant_screen.dart:113` (whole list); `app/features/ai/data/ai_transport.dart:167-185` (no trimming), `:187-192` (400 becomes `unavailable`); `ai.types.ts:37-43`; demo in §1 | Send only the most recent turns that fit (at most 20 prior turns and a character budget), skipping error and empty bubbles. Flutter only, no API change. Unit and widget tests. **Slice AI-P.** |
| **AI0-F2** | **High (launch)** | **No in-app way to report AI output.** Google Play's AI-Generated Content policy requires apps that generate content with AI to let users report or flag offensive content without leaving the app (policy text as quoted in the sources in §11). | No report affordance in `app/features/ai/`, `app/features/focus_shield/weekly_review_screen.dart` or `app/features/analytics/presentation/analytics_screen.dart`; no backend endpoint | Report action on assistant replies, the weekly coaching card and the analytics insight; `POST /api/v1/ai/reports`; table `ai_content_reports` (owner SQL). **Slice AI-P.** |
| AI0-F3 | Medium | The system prompt is concatenated into the final user turn rather than sent through the provider's system-instruction channel. User text then sits next to policy text, which weakens prompt-injection resistance. A unit test pins this behaviour. | `ai.service.ts:63-90`; `tests/unit/ai-proxy.test.ts:139` | Move it to the system-instruction field and update the test deliberately. **AI-1.** |
| AI0-F4 | Medium | 17 of 23 `AiService` prompt methods are unreachable. They include `generateWorkoutPlan` and `generateMealPlan` (health-adjacent, against the medical-claims non-goal) and the client-context paths. This is dead egress surface. | `ai_service.dart:365,385` and caller search; reachable: `sendMessage` (task parser), `streamMessage` (assistant), `generateWeeklyCoaching`, `getCumulativeAnalysis`, `getPerformanceDashboard` | Delete the unused methods and their tests. **AI-1** (decision D6). |
| AI0-F5 | Low | No explicit provider safety settings: provider defaults apply implicitly. | `gemini-client.ts:124` sends `generationConfig` only | Explicit, server-owned safety settings. Values are checked against the provider documentation during implementation. Tests. **AI-1.** |
| AI0-F6 | Low | The chat validator is hand-written and ignores unknown keys (not strict Zod). | `ai.service.ts:124-201` | Keep it as is for compatibility. Every new AI endpoint uses strict Zod. |
| AI0-F7 | Info | Three consent patterns: the assistant asks in memory per screen; weekly coaching and analytics ask per request and send aggregates only; AI task parsing uses a durable opt-in on the device. | `ai_assistant_screen.dart:91-111`; `weekly_review_screen.dart:101-124`; `analytics_screen.dart:90-128`; `app/features/auth/presentation/profile_screen.dart:139-163` with `app/data/ai_task_parsing_pref.dart` | AI-2 adds one durable, versioned account-level consent (D5). |
| AI0-F8 | Info | The analytics consent text includes a hard-coded English literal. | `analytics_screen.dart:106` | Already counted in the literal baseline; localize it when the screen is touched. |
| AI0-F9 | Info | The server's fallback reply-language hint is `'Arabic'` when the client omits `language`; `users.locale` is not used. | `ai.service.ts:186` | AI-1 resolver order: latest message, then the client hint, then `users.locale`, then English. |
| AI0-F10 | Info | The `product_events` CHECK constraint lists the six event names, so any AI usage event needs owner SQL. | `…/migrations/1792750000000_product_events_and_onboarding.cjs:31` | Optional, later (D7). |

## 4. Discrepancies in the specification

1. **Phase numbering.** Part I uses AI-0…AI-6 (authoritative). Part II §11 uses AI-0…AI-4
   with 23–33 day estimates, and its "AI-2 Memory" is Part I's AI-3. This audit follows
   Part I and re-estimates (§7).
2. **`ai_user_settings.provider_preference`** (Part II §5.2) contradicts "provider
   selection explicit at the server configuration level, no silent switching" (Part II
   §4.2, Part I §8). Proposal: omit the column until AI-6 (D3).
3. **`memory_data JSONB`** (Part II §5.2). Proposal: `content TEXT` of at most 500
   characters plus a `kind`. That keeps validation, export and review simple; use JSONB
   only if structured preferences become necessary (D4).
4. **"Client may send context JSON."** The code path exists but is unused. AI-2 deletes it
   instead of migrating it.
5. **Migration naming.** The illustrative `1792780000000_ai_memory_and_preferences.cjs`
   is free. This audit proposes one migration per slice instead: three small owner SQL
   files, each verifiable on its own.
6. **Part I §11.1 "Prod SQL confirm (G2/G6)":** done (owner-reported, 2026-11-11).
7. **Missing from the specification:** the Play reporting requirement (AI0-F2) and the
   history-window defect (AI0-F1). Both block an AI-first launch.

## 5. Slice designs (proposals)

All slices: strict Zod on new endpoints, ownership from the session, rate limits,
OpenAPI, six languages, G7 on new UI, no prompt or reply logging, `AI_ENABLED` and quotas
preserved, forward-only migrations with owner SQL and verification queries. Deployment
order: SQL, then backend, then app.

### AI-P — pre-launch: Play reporting and the history window (new, before the closed test)

- **AI0-F1 fix (Flutter only).** Build the request history from the last turns that fit:
  at most 20 prior turns and at most 20,000 characters, newest first. Exclude error
  bubbles and empty placeholders. The full history stays visible and saved on the device.
- **Report UI.** A flag icon button (48 dp, tooltip and semantics label "Report reply")
  on every AI reply bubble, the weekly coaching card and the analytics insight card. It
  opens a bottom sheet:
  - Categories: offensive or hateful; harmful or dangerous; wrong or misleading; spam;
    something else.
  - A checkbox "Include the reply so we can review it", on by default (D1).
  - An optional note of at most 500 characters.
  - Send and Cancel, then a confirmation message.

  The report path works while AI is disabled (reporting an earlier reply). Six
  languages; G7 (labels, 48 dp, 200% Arabic, RTL).
- **API.** `POST /api/v1/ai/reports`, mounted outside the kill switch, authenticated,
  strict Zod, 10 per hour per user, `Cache-Control: no-store`:

  ```text
  body: {
    surface:   'assistant' | 'weekly_coaching' | 'analytics_insight',
    category:  'offensive' | 'harmful' | 'inaccurate' | 'spam' | 'other',
    replyText?: string 1..4000   // only when the user ticked the checkbox
    note?:      string 1..500,
    locale:     string 2..16     // letters and '-'
  }
  201 { reported: true } | 400 | 401 | 429 | 503 AI_REPORTS_UNAVAILABLE (until the owner SQL ran)
  ```

- **Table** (sketch; owner SQL plus migration `1792780000000_ai_content_reports.cjs`):

  ```sql
  CREATE TABLE ai_content_reports (
    id         UUID PRIMARY KEY,           -- same id convention as existing tables
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    surface    TEXT NOT NULL CHECK (surface IN ('assistant','weekly_coaching','analytics_insight')),
    category   TEXT NOT NULL CHECK (category IN ('offensive','harmful','inaccurate','spam','other')),
    reply_text TEXT CHECK (reply_text IS NULL OR char_length(reply_text) BETWEEN 1 AND 4000),
    note       TEXT CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
    locale     VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX ai_content_reports_created_at_idx ON ai_content_reports (created_at);
  CREATE INDEX ai_content_reports_user_id_idx ON ai_content_reports (user_id);
  ```

  - **Lifecycle:** 90-day retention purge in the worker (D1). A JSON-export section, plus
    the documented v1-archive exclusion. Delete order, `ON DELETE CASCADE` and
    `OPTIONAL_USER_OWNED_TABLES` while the SQL is pending.
  - **Grants and schema:** runtime-role grants (SELECT, INSERT, DELETE); `schema.sql` and
    `schema-sql.ts`.
  - **Moderation:** a documented read-only review query for the owner in the Neon console.
    No admin UI, which means less attack surface.
- **Tests:**
  - Strict body and unknown keys; the rate limit; acceptance while AI is disabled.
  - Export and deletion coverage; the retention purge; the restricted-role sequence.
  - History-window unit test; widget tests for the sheet at 200% Arabic with labels.
- **Estimate:** about 1 day of agent time, plus the owner SQL.

### AI-1 — provider-neutral core (no public API change, no SQL)

- `be/features/ai/providers/ai-provider.ts`: the interface
  `generate(input) → { text }` and `stream(input) → AsyncIterable<string>`. The input
  carries `systemInstruction`, `turns`, `generation` and an optional `responseSchema`.
- `providers/provider-registry.ts`: `AI_PROVIDER` env, where only `gemini` is accepted.
  Any other value fails at startup; there is no fallback.
- `providers/gemini.adapter.ts`: wraps the existing `FetchGeminiClient`. It sends the
  system prompt through the system-instruction field (AI0-F3) and explicit safety
  settings (AI0-F5).
- `application/ai-language-resolver.ts`: unambiguous script detection on the latest
  message (for example Arabic), then the client hint, then `users.locale`, then English.
  The model still answers in the language of the request (current behaviour).
- `/ai/chat` and `/ai/chat/stream` stay byte-compatible. The existing 21 tests stay green
  except the deliberate change at `ai-proxy.test.ts:139`.
- Flutter: delete the 17 unreachable `AiService` methods (AI0-F4, D6). No UI change.
- **Tests:** provider contract; registry refuses unknown providers; adapter sends the
  system instruction and safety settings; resolver for six locales, mixed and short input.
- **Estimate:** about 1 day.

### AI-2 — settings, durable consent, server-side context

- **Table** `ai_user_settings` (migration `1792790000000_ai_user_settings.cjs`):

  ```sql
  CREATE TABLE ai_user_settings (
    user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    egress_consent_version  INTEGER CHECK (egress_consent_version IS NULL OR egress_consent_version > 0),
    egress_consent_at       TIMESTAMPTZ,
    memory_enabled          BOOLEAN NOT NULL DEFAULT false,
    explicit_memory_enabled BOOLEAN NOT NULL DEFAULT false,
    learning_enabled        BOOLEAN NOT NULL DEFAULT false,
    quick_actions_enabled   BOOLEAN NOT NULL DEFAULT false,
    language_mode           TEXT NOT NULL DEFAULT 'auto' CHECK (language_mode IN ('auto','app_locale')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((egress_consent_version IS NULL) = (egress_consent_at IS NULL))
  );
  ```

- **`GET /api/v1/ai/settings`** returns
  `{ settings, currentConsentVersion, available }`. Defaults with `available: false` are
  returned until the SQL is applied (G2 pattern).
- **`PATCH /api/v1/ai/settings`** takes a strict partial body (the fields above in
  camelCase). It answers 409 `AI_CONSENT_VERSION_MISMATCH` for a stale version, 503 until
  the SQL is applied, and is limited to 30 per minute.
- **`POST /api/v1/ai/assistant/turn`**, plus a `/stream` variant with the same body:

  ```text
  body: {
    message:        string 1..4000,
    conversation?:  [{ role: 'user'|'model', text: 1..4000 }] at most 20, total ≤ 24000,
    contextScopes?: unique subset of ['today','tasks','habits','goals','calendar'],
    clientLocale?:  string ≤ 16
  }
  → { type: 'answer', text, language }
  | { type: 'clarification_required', question, language }
  | { type: 'unsupported_or_denied', reason: 'consent_required'|'scope_unavailable'|'unsupported' }
  ```

  - **Shared limits:** the same kill switch and the same quota buckets as `/ai/chat`.
  - **Consent:** any context scope requires the current consent version.
  - **Context builder:** reads only through domain-service list methods, with hard caps:
    - Today's tasks: at most 20, with title, due time and priority.
    - Habits: at most 10, with name, today's status and streak.
    - Goals: at most 10, with title and progress.
    - Today's events: at most 10, with title and times.
  - **Context framing:** timezone and an as-of timestamp from `users.timezone`. Never note
    bodies, never Money areas. Context is framed as untrusted data.
- **Flutter:** durable consent replaces the in-memory flag. Delete the client-context
  methods. A context toggle in the assistant.
- **Tests:**
  - Context isolation between two users; consent required and version mismatch.
  - Caps enforced; no notes or Money in the context.
  - Export and deletion; owner SQL rehearsal.
- **Estimate:** about 1.5 days, plus the owner SQL.

### AI-3 — explicit memory

- **Table** `ai_memory_items` (migration `1792800000000_ai_memory_items.cjs`):

  ```sql
  CREATE TABLE ai_memory_items (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('preference','fact')),
    content     TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
    source      TEXT NOT NULL CHECK (source IN ('explicit','learned')),
    status      TEXT NOT NULL CHECK (status IN ('pending','active','dismissed')),
    confidence  NUMERIC(3,2) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ,
    CHECK (source = 'learned' OR status <> 'pending')
  );
  CREATE INDEX ai_memory_items_user_status_idx ON ai_memory_items (user_id, status);
  ```

- **Endpoints:**
  - `GET /api/v1/ai/memories?status=active|pending` (at most 100, `truncated` flag).
  - `POST /api/v1/ai/memories` `{ kind, content }`: explicit and active. Requires
    `memoryEnabled` and `explicitMemoryEnabled`. 409 `AI_MEMORY_LIMIT` at 100 active
    items.
  - `PATCH /api/v1/ai/memories/:id` and `DELETE /api/v1/ai/memories/:id`.
  - `DELETE /api/v1/ai/memories` (all, after a confirmation in the app).
  - Other users' ids give 404; 30 per minute.
- **Memory creation:** in AI-3 the model never writes memory. Items come from the Memory
  screen and from a "Save to memory" action on the user's own message. Active memories
  enter the context only when `memoryEnabled` is on.
- **Flutter:** Profile → AI → Memory, with list, edit, delete and delete-all; six
  languages; G7.
- **Tests:** the full lifecycle, toggles respected independently, export and deletion,
  cross-user 404, caps.
- **Estimate:** about 1.5 days, plus the owner SQL.

### AI-4 — bounded tools and confirmed proposals

- `assistant/turn` adds two response types:
  - `{ type: 'action_proposed', proposalId, preview, expiresAt }`
  - `{ type: 'action_executed', result }`
- **Model output contract:** strict schema
  `{ kind: 'answer'|'clarify'|'tool_call', text?, question?, tool?, args? }`, parsed with
  Zod. Anything invalid becomes `unsupported_or_denied` and is never executed.
- **Initial tools:**
  - `tasks.create`, `tasks.update`, `tasks.get`, `tasks.list`
  - `goals.create`, `goals.update`, `goals.list`
  - `projects.create`, `projects.update`, `projects.list`

  All go through the existing domain services, with `userId` taken from the session
  only.
- **Policy:**
  - Deletes are proposals only, and only where a restore exists.
  - Bulk actions (more than one entity) are always proposals.
  - Direct execution applies only to a single create or update, when
    `quickActionsEnabled` is on and every required argument is present. Missing or
    ambiguous arguments lead to a clarification.
- **Proposals in Redis:**
  - Key `ai:proposal:<uuid>`, TTL 600 s, holding the user id, tool, arguments, argument
    hash and target `updated_at`.
  - Confirm runs an atomic Lua check-and-delete bound to the user. The result is kept for
    600 s, so a duplicate confirm returns the same result.
  - A foreign or expired id gives 404; a changed target gives 409 `AI_PROPOSAL_STALE`.
- `POST /api/v1/ai/actions/:proposalId/confirm` and `/cancel`: empty strict bodies;
  cancel is idempotent.
- **Tests:**
  - Quick Actions on and off; ambiguous requests; destructive and bulk actions.
  - Expired, stale and duplicate confirms.
  - Prompt injection from task or note text cannot add tools or skip confirmation.
  - Forged `model` turns in `conversation` cannot cause execution.
  - Cross-user ids give 404.
- **Estimate:** about 2–3 days. It is the riskiest slice, so ship it as an update after
  launch unless it is fully verified before then.

### AI-5 — governed inferred preferences

- **Suggestions:** within a turn, the model may return a memory suggestion. It is stored
  as `source='learned', status='pending'`, with `expires_at` after 30 days, and only
  when `learningEnabled` is on.
- **Sensitive categories:** rejected on the server (health, religion, ethnicity, sexual
  orientation, political views, finances, precise location).
- `POST /api/v1/ai/memories/:id/approve` and `/dismiss`.
- **Flutter:** a "Suggestions" section in the Memory screen.
- **Tests:** pending items are never used in context, approval or dismissal, expiry, the
  denylist.
- **Estimate:** about 1 day.

### AI-6 — optional second provider

A second adapter behind the same interface, only after a separate decision on the
provider, data terms, cost, latency and privacy disclosure. The provider is selected by
server configuration, with no fallback and no parallel calls. Estimate: about 1 day after
that approval.

## 6. Threat model

| # | Threat | Control | Slice | Test |
| :--- | :--- | :--- | :--- | :--- |
| T1 | Prompt injection through user content placed in context (task or note text) | System-instruction channel; context framed as data; allow-listed tools; strict output parsing; the policy engine decides, not the model | AI-1, AI-2, AI-4 | Injection corpus cannot add tools, skip confirmation or change scope |
| T2 | Forged history (the client sends invented `model` turns) | Permissions never derived from history; proposals are server-generated, user-bound and single-use; confirm needs no model output | AI-4 | Forged turns cannot cause execution |
| T3 | IDOR through ids supplied by the model or the client | `userId` from the session only; every tool goes through the ownership-checked domain services; foreign ids give 404 (as in G6) | AI-2…AI-5 | Two-user isolation tests on every endpoint and tool |
| T4 | Replay or double confirm | Atomic Lua check-and-delete; stored result; `updated_at` revalidation | AI-4 | Duplicate, concurrent and stale confirms |
| T5 | Account data sent to the provider without consent | Durable, versioned consent checked on the server before any context leaves; the disclosure names Google Gemini; coaching and analytics stay aggregates-only | AI-2 | No consent or an old version means no context in the provider request |
| T6 | Memory poisoning or sensitive inference | Inferred items stay pending; sensitive-category denylist; approve or dismiss; expiry; per-toggle enforcement | AI-3, AI-5 | Lifecycle and denylist tests |
| T7 | Cost abuse | Existing quotas (10 per minute, 200 per day), body caps, per-endpoint limits, kill switch | All | Quota and limit tests |
| T8 | Logs leak content | No prompt or reply logs. User-initiated reports are the only deliberate content storage: bounded, retained 90 days, covered by export and deletion | AI-P | Log assertions; retention purge |
| T9 | Offensive or harmful output | Explicit safety settings; in-app reporting; the owner reviews reports | AI-P, AI-1 | Report flow tests; device check |
| T10 | AI rows survive deletion or are missing from export | Every AI table in the delete order and the JSON export; unit assertions like `account-archive.test.ts` | AI-P, AI-2, AI-3 | Export and deletion tests per table |
| T11 | Provider outage blocks the app | AI stays optional; safe 502/503; the client circuit breaker; core flows untouched | All | AI-disabled and provider-failure tests |
| T12 | Silent second-provider egress | Server configuration only; no fallback; separate approval | AI-6 | Registry refuses unknown or extra providers |

## 7. Estimates and calendar

Agent working time, excluding owner waits:

| Slice | Estimate |
| :--- | :--- |
| AI-P | ~1 day |
| AI-1 | ~1 day |
| AI-2 | ~1.5 days |
| AI-3 | ~1.5 days |
| AI-4 | ~2–3 days |
| AI-5 | ~1 day |
| AI-6 | ~1 day, after its own approval |

That is about 9–10 days in total. With approvals, owner SQL and device checks, the
realistic calendar is **4–6 weeks**. These are planning ranges, not commitments.

## 8. Launch path with AI first (recommendation)

1. **Week 1.**
   - **Owner:** signing key and the `android-release` environment; device pass; recruit
     15–20 testers; Play Console app setup.
   - **Owner, AI for testers:**
     - A Gemini API key from a Google Cloud project with an active billing account (paid
       tier), plus a budget alert. On the unpaid tier, prompts and replies may be used to
       improve Google products and read by human reviewers. Apps offered in the EEA,
       Switzerland or the UK must use paid services, and the app ships German, Spanish
       and French.
     - Railway variables `AI_ENABLED=true` and `GEMINI_API_KEY`. Startup logs a warning
       when the key is missing (`be/container.ts:371-372`).
     - This environment cannot read Railway, so whether AI is on in production today is
       unknown.
   - **Agent:** AI-P; an App Bundle (`.aab`) release build (the signed job builds an APK
     only); privacy-policy and Data safety drafts that name Google Gemini and AI reports.
   - **Owner:** AI-P SQL, then merge, then the signed bundle, then the closed test starts.
2. **During the 14 days:** AI-1, AI-2 and AI-3 ship as closed-track updates, each in the
   order SQL, backend, app. Regular updates with feedback also strengthen the
   production-access application.
3. **Weeks 3–4:** apply for production access (Google states up to 7 days); then the
   public launch with the AI slices that passed.
4. **After launch:** AI-4, then AI-5, then E3. AI-6 only after its own approval.

## 9. Owner decisions

| # | Decision | Recommendation |
| :--- | :--- | :--- |
| D0 | May AI implementation (AI-1 onward) run in parallel with launch verification? Part I asks for an explicit choice | **Yes:** AI-P first (launch-critical), then AI-1 onward during the closed test |
| D1 | AI-P report contents and retention | **Reply text included when the user ticks the box (on by default), category, optional note; 90 days; owner reviews with a read-only query.** Rejected alternatives: category only (useless for moderation); email or a web form (leaves the app, so not compliant) |
| D2 | Slice order | **AI-P → AI-1 → AI-2 → AI-3 → AI-4 → AI-5; AI-6 separately; E3 after AI-4** |
| D3 | `provider_preference` column | **Omit until AI-6** |
| D4 | Memory format | **`content TEXT` of at most 500 characters plus `kind`** (rather than JSONB) |
| D5 | Consent model | **One durable, versioned account-level consent for sending account data (AI-2).** Coaching and analytics keep their per-request aggregate dialogs; AI task parsing keeps its device opt-in |
| D6 | Delete the 17 unreachable prompt methods, including workout and meal plans | **Yes, in AI-1** |
| D7 | Content-free G5 event `ai_turn_completed` to measure whether AI drives Day-7 retention (owner SQL widens the CHECK) | **Later, with AI-2** |
| D8 | Chat history storage | **Stays on the device, with no server sync** (Part II §7.3) |

## 10. NOT RUN

- Flutter analyze and tests for this audit (no local Flutter); not needed for a docs-only
  commit.
- Hosted CI for the commit that adds this report: pending until a pull request exists,
  because `ci.yml` does not run on pushes to this branch.
- AI0-F1 on a device. It was found by reading the code plus the server-side demo in §1;
  the "12th message" threshold assumes no error bubbles in the history.
- Production database (no access from here).

## 11. External sources

- Google Play AI-Generated Content policy (in-app reporting without leaving the app), as
  quoted by: <https://www.sume.com/blog/google-play-ai-generated-content-policy-in-app-report-button-ai-video-app>
  and <https://dev.to/mdodeja/ai-chatbots-in-mobile-apps-where-the-article-50-disclosure-goes-3g7l>.
  The owner should read the policy page in Play Console when filling in the store forms.
- Gemini API data use, unpaid versus paid tier, as summarised by:
  <https://jazz.security/dlp-explained/dlp-basics/is-gemini-safe-for-company-data/> and
  <https://www.januscompliance.co.uk/blog/is-the-gemini-api-gdpr-compliant-2026>. The owner
  should confirm against Google's Gemini API Additional Terms before launch.
- Closed-test releases are reviewed before testers receive them:
  <https://www.testerscommunity.com/guides/internal-vs-closed-vs-open-testing-google-play>
  and <https://catdoes.com/blog/testflight-for-android>.
- Closed-testing rule for new personal accounts (12 testers, 14 continuous days, then a
  production-access review): <https://cadrant.ai/blog/google-play-closed-testing> and
  <https://vmobify.com/blog/google-play-closed-testing-requirement>.
