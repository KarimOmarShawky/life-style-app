# Hybrid AI — slice AI-1 report: provider-neutral core (2026-11-12)

> **Historical snapshot** — work on branch `arena/04c63949-life-style-app` (draft PR #32),
> 2026-11-12. Evidence below is tied to the cited commits. This is not a release approval:
> a real Gemini call with the new request body, device behaviour and the Play submission are
> NOT RUN here.

Branch `arena/04c63949-life-style-app`, draft PR #32. Plan: section "AI-1 — provider-neutral core"
of `docs/reports/hybrid-ai-ai0-audit-2026-11-11.md`, approved by the owner on 2026-11-12 ("go",
D0–D9 as recommended).

| Commit | Content |
| --- | --- |
| `b048000` | App: delete the 16 unreachable `AiService` prompt methods (D6) |
| `ed21344` | Backend: provider interface, registry, Gemini adapter, safety blocks, language resolver |
| this commit | AI notice wording, free-tier guide, tester guide, this report |

## Result

AI-1 is done as planned, with one deliberate deviation (AI1-F1). There is no public API change, no
SQL and no new dependency. `POST /api/v1/ai/chat` and `/ai/chat/stream` keep their request and
response shapes, quotas and `AI_ENABLED`. Prompts and replies are still never logged.

## What changed

| Plan item | Done |
| --- | --- |
| `providers/ai-provider.ts`: `generate` / `stream` over system instruction, turns, generation | Yes, with a neutral `AiProviderError`; `GeminiProviderError` extends it. `responseSchema` deferred (AI1-F1) |
| `providers/provider-registry.ts`, `AI_PROVIDER` accepts only `gemini`, no fallback | Yes. The env schema stops startup for any other value; the registry refuses it too |
| Gemini adapter: system prompt through the system-instruction field (AI0-F3) | Yes. User turns now carry only the user's text; the old `System context: … User request:` wrapper is gone |
| Explicit safety settings (AI0-F5) | Yes: harassment, hate speech, sexually explicit and dangerous content at `BLOCK_MEDIUM_AND_ABOVE` ("Block some"). Google's safety-settings page: since Gemini 2.5 these filters are **off** unless a request sets them. The types allow no "off" value |
| Language resolver (AI0-F9) | Yes: clearly Arabic script in the latest message, else the client's hint, else the account locale, else English (the default was Arabic). The model still answers in the language of the message |
| Endpoints byte-compatible; the 21 proxy tests stay green except the deliberate change | Yes. Deliberate changes: the system-instruction test (was `ai-proxy.test.ts:139`) and `languageHint` (null when absent) instead of the `'Arabic'` default in two validator tests |
| App: delete the unreachable `AiService` methods (D6) | Yes: **16**, not 17 as AI-0 counted. Kept: `sendMessage`, `streamMessage`, `generateWeeklyCoaching`, `getCumulativeAnalysis`, `getPerformanceDashboard`, `isPaused`, `bindGateway`. No UI change |

Added beyond the plan, because the explicit filters make blocks more likely:

- A prompt Gemini refuses (`promptFeedback.blockReason`) or a reply it stops (`finishReason` SAFETY,
  PROHIBITED_CONTENT, BLOCKLIST, SPII) is the new failure kind `blocked`. It is never returned as
  text, also not in part when streaming (the app discards the partial bubble on a stream error).
  Clients get the same generic error as before. Only the kind is logged, so the owner can see how
  often the filters act; mid-stream failures are now logged too (they were not).
- The in-app AI notice now says "Don't type passwords, personal details or sensitive
  information" in all six languages, because the unpaid Gemini terms forbid personal information.
- `docs/ai/gemini-free-tier.md`: settings and limits for the unpaid tier (owner decision
  2026-11-12), and the steps to switch to paid.

AI0-F6 (hand-written chat validator) stays as the audit recommends; new AI endpoints use strict Zod.

## Verification

Local, on the final tree:

| Check | Result |
| --- | --- |
| Backend `npx vitest run tests/unit` | PASS: 58 files, 641 tests (new `ai-provider.test.ts`: 20; `ai-proxy.test.ts`: 21) |
| Backend `tsc --noEmit`, `tsc -p tsconfig.verification.json`, eslint, prettier (changed files) | PASS |
| Backend `npm run openapi:check` | PASS, no API document change |
| Root `node --test scripts/*.test.mjs` | PASS: 195 (the D6 contract test replaces four pinning tests with three) |
| `check-l10n`, `check-docs-consistency`, `check:forbidden`, `scan-secrets` | PASS (0 findings) |
| Flutter analyze/tests, Kotlin tests | CI only (no SDK in this workspace) |

CI: see the PR #32 description for the runs on these commits.

NOT RUN: a real Gemini call with the new request body (needs the owner's key) and device tests.
First check after the key is set on Railway: send one assistant message in Arabic and one in
English; each reply should come in the same language. A `blocked` count in the logs shows how often
the filters act.

## Findings

- **AI1-F1 (deviation, low).** `responseSchema` is not in the interface yet. Nothing in AI-1 uses
  structured replies, and Gemini's field names should be checked against the live API with the
  first feature that needs them (AI-4 proposals). An unused path would also be untested.
- **AI1-F2 (app, low; owner decision).** The app's AI circuit breaker pauses AI after three
  failures in a row and never resumes during that app session (`resetFailureCount()` has no
  caller), while the message says "try again shortly". On the unpaid tier, testers who hit the
  daily limit must close and reopen the app; the tester guide says so. Recommendation: resume
  after a timer (for example 10 minutes). Small Flutter change, not in AI-1.
- **AI1-F3 (copy, info).** The Smart Quick Add consent text does not ask people to leave out
  personal details; the assistant notice now does. Optional to align.

## Owner actions

- Unpaid tier: follow `docs/ai/gemini-free-tier.md` (Railway values, Play country restriction,
  policy paragraph, Data safety).
- Then the smoke test above.

## Next

AI-2 (settings table, durable versioned consent, server-side context; forward-only migration plus
owner SQL), then AI-3 (explicit memory), as closed-track updates. Decision pending: AI1-F2.
