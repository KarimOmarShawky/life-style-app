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
| 2c | Flutter: durable consent instead of the in-memory flag, context switch in the assistant | done (section "Part 2c") |

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

## Part 2c — the app (Flutter)

Owner: "كمل" after the AI-2b report.

- **Stored consent:** the assistant reads `GET /ai/settings` when it opens. With the current
  consent stored, it does not ask; otherwise it asks once and stores the answer with
  `PATCH {egressConsentVersion: 1}`. If the server cannot store it (`available: false`, an
  error, no connection), the answer counts for the open assistant only, as before AI-2c. An app
  whose consent version differs from the server's never records a consent it did not show
  (the switch is then hidden). `lib/features/ai/data/ai_settings_client.dart`.
- **"Use my app data":** a switch under the chat, off by default, per account on the phone
  (`ai_context_preference.dart`). Turning it on first explains what is added. With it on, the
  turn carries `contextScopes` [today, tasks, habits, goals, calendar]. It is shown only when the
  consent can be stored, so context is never requested where the server would refuse it.
- **Turn endpoint:** every assistant message now goes to `POST /ai/assistant/turn/stream` with
  `message`, the trimmed `conversation` (same AI0-F1 window: at most 20 earlier turns, 24,000
  characters) and `clientLocale`. Denials become typed errors: `consent_required` asks again,
  `scope_unavailable` and `unsupported` show a short localized message; none of them counts
  toward the AI pause. A stream that fails after some text removes the partial reply. A server
  without the endpoint (404) gets messages without app data through `/ai/chat/stream`.
- **Withdrawal:** Profile → "AI consent" → Withdraw sends `egressConsentVersion: null`. The
  assistant stays alive in the home shell, so a small Riverpod counter tells it to forget the
  consent; its next message asks again. Before the owner SQL (503 `AI_SETTINGS_UNAVAILABLE`)
  only that in-memory consent is forgotten.
- **G7 and strings:** 15 new keys in ar/en/de/es/fr/tr. The send button gained a tooltip (it had
  no label for TalkBack), the assistant title ellipsizes instead of overflowing at 200% text, and
  the consent, app-data and withdrawal dialogs scroll as a whole, so no text is cut off.
- **Unchanged:** chat history stays on the phone (D8); 18+ check (D9) first; no new dependency.

### Evidence (part 2c)

| Check | Result |
| --- | --- |
| Flutter analyze / format / tests | NOT RUN locally (no Flutter SDK); CI on the AI-2c commit |
| `dart format` style of every changed Dart file (WASM `@wasm-fmt/dart_fmt` 0.4.0, language 3.5) | PASS (0 files to change) |
| `node scripts/check-dart-syntax.mjs …` (all tracked and new Dart files) | PASS |
| Root: `node --test scripts/*.test.mjs` | PASS (200, 5 new in `ai-assistant-app-contract.test.mjs`) |
| Root: l10n (literal ratchet unchanged at 85), docs consistency, forbidden deps | PASS |

New tests: `test/ai_assistant_turn_test.dart` (transport, denials, 404 fallback, pause rules,
settings client), `test/ai_assistant_consent_test.dart` (stored consent, fallback, switch,
denials, partial reply, withdrawal, G7 Arabic at 200%), `test/ai_consent_withdraw_test.dart`
(Profile entry, failure paths, G7 Arabic at 200%).

NOT RUN: a device pass (AI2C-1…5 in `docs/mobile/manual-test-checklist.md`), the owner SQL on
Neon, a real Gemini request with app data.

### Findings (part 2c)

- **AI2c-F1 (info):** the switch is stored per account on the phone, not on the server; a
  reinstall turns it off again (the consent itself is kept). Accepted: off is the safe default.
- **AI2c-F2 (info):** a consent withdrawn on another phone reaches an open assistant at its next
  app-data message (the server answers `consent_required`); plain messages ask again after the
  app restarts.
- **AI2c-F3 (low):** before the owner SQL, the switch is hidden and the consent is asked once per
  app start. Running `docs/ai/sql/ai-user-settings.sql` turns on both.
- **AI2c-F4 (low, existing):** the quick-suggestion row above the chat has a fixed 48 dp height,
  so at 200% text its chip labels are clipped (no error). Not changed here; candidate for the
  next G7 pass.

## Next

AI-3 (explicit memory, D4): the user saves, lists and deletes short memories; the assistant uses
them only when memory is on.
