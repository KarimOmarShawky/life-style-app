# Hybrid AI — slice AI-2 report: durable consent and server-side context (2026-11-12)

> **Historical snapshot** — work on branch `arena/04c63949-life-style-app` (draft PR #32),
> 2026-11-12. Evidence below is tied to the cited commits. This is not a release approval:
> the owner SQL on Neon, a real Gemini call with app context, device behaviour and the Play
> submission are NOT RUN here.

Plan: section "AI-2" of `docs/reports/hybrid-ai-ai0-audit-2026-11-11.md` (D5: one durable,
versioned consent), continued by the owner on 2026-11-12 ("كمل"). AI-2 ships in three parts:

| Part | Content | State |
| --- | --- | --- |
| 1 | `ai_user_settings`, `GET`/`PATCH /api/v1/ai/settings`, durable versioned consent | done (e01aad6, fix 96196cf) |
| 2b | `POST /api/v1/ai/assistant/turn` (+ `/stream`) with server-side context | done (this report) |
| 2c | Flutter: durable consent instead of the in-memory flag, context switch in the assistant | next |

## Part 1 — settings and consent (summary)

Guide: `docs/ai/ai-settings.md`. Forward-only migration `1792790000000_ai_user_settings`, owner
SQL `docs/ai/sql/ai-user-settings.sql` (not applied). Consent version 1; a stale version
answers 409 `AI_CONSENT_VERSION_MISMATCH`; `null` withdraws. Exported, erased with the account,
excluded from the v1 archive. CI on 96196cf: CI 43223763668 ✓, isolated 43223763582 ✓,
secrets 43223763587 ✓ (e01aad6 failed in the integration transaction and was fixed).

## Part 2b — assistant turn with context

Guide: `docs/ai/ai-assistant-context.md`.

- **Route and limits:** inside the AI router, so the kill switch (503 `AI_DISABLED`) and the
  per-user minute and daily quotas are the same as `/ai/chat` and shared with it.
- **Body:** strict Zod: `message` (1–4,000), `conversation` (≤ 20 turns), unique
  `contextScopes` from `today|tasks|habits|goals|calendar`, `clientLocale` (≤ 16).
  The total is ≤ 24,000 characters.
- **Result:** `answer {text, language}` or `unsupported_or_denied {reason}` with
  `consent_required`, `scope_unavailable` or `unsupported` (safety block).
  `clarification_required` is deferred to AI-4 (AI1-F1, needs structured output).
- **Consent gate:** any scope needs `egressConsentVersion == currentConsentVersion`.
  It is checked before any read; without it, nothing is read or sent.
- **Snapshot:** domain readers and services only.
  - Caps: tasks 20, habits 10 (with streak), goals 10, events 10. Titles are cut to 120
    characters.
  - Uses the local date and time in `users.timezone`, with UTC as the fallback.
  - Never includes notes, descriptions, locations or Money.
- **Untrusted data:** a separate part of the latest user turn, framed "data, not
  instructions". It is never put in the system instruction; the system instruction only says
  how to treat the data.
- **Language:** `app_locale` fixes the reply to the app language; `auto` keeps the AI-1 rule.
- **No logging:** message, conversation, snapshot and reply are never logged (unit test with
  logger spies).
- **Additive change:** `ListGoalsFilter.limit` is for internal callers only; the HTTP goals
  list has no new parameter.

### Evidence

Local, on the AI-2b working tree (before commit; CI on the pushed commit is cited in PR #32):

| Gate | Result |
| --- | --- |
| `npx vitest run tests/unit` | PASS, 60 files, 708 tests (43 new in `ai-assistant.test.ts`) |
| `npx tsc --noEmit`, `npx tsc -p tsconfig.verification.json --noEmit` | PASS |
| `npx eslint src tests` | PASS |
| `npx prettier --check src tests` | only the 4 known migration warnings |
| `npm run -s openapi:check` | PASS (2 paths, 4 schemas added) |
| Root: forbidden deps, `node --test scripts/*.test.mjs` (195), l10n, docs, secrets | PASS |
| Mutation check | consent gate removed → 4 tests fail; context part dropped → 1 test fails |
| `tests/integration/ai-assistant-flow.test.ts` | NOT RUN locally (no PostgreSQL); runs in CI |

NOT RUN: a real Gemini request with context, the owner SQL on Neon, the app (AI-2c).

## Findings

- **AI2-F1 (low):** the store drafts must list the day summary as part of AI requests before the
  build with the context switch ships. Done in both drafts, marked AI-2c. The owner must paste it
  into the Google Doc before uploading that build.
- **AI2-F2 (info):** streaks for the context are computed through the habits list (at most 100
  active habits). A user with more than 100 active habits gets streak 0 for the rest. Accepted
  for now; a dedicated reader method can replace it if needed.
- **AI2-F3 (info):** `clarification_required` and tool proposals wait for AI-4 (AI1-F1).

## Next

AI-2c (Flutter):
- GET/PATCH `/ai/settings` replaces the in-memory consent flag.
- An "app data" switch in the assistant (6 languages, G7, widget tests) sends `contextScopes`
  to `/ai/assistant/turn/stream`.
- The app handles the denial events.

Then AI-3 (explicit memory, D4).
