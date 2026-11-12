# Hybrid AI — slice AI-3 report: explicit memory (2026-11-12)

> **Historical snapshot** — work on branch `arena/04c63949-life-style-app` (draft PR #32),
> 2026-11-12. Evidence below is tied to the cited commits. This is not a release approval:
> the owner SQL on Neon, a real Gemini call with saved memories, device behaviour and the Play
> submission are NOT RUN here.

Plan: section "AI-3" of `docs/reports/hybrid-ai-ai0-audit-2026-11-11.md` (decision D4: a memory
is a short text plus a kind). Owner: "كمل" after the AI-2c report. AI-3 ships in two parts:

| Part | Content | State |
| --- | --- | --- |
| 3a | Table `ai_memory_items`, `/api/v1/ai/memories`, memories in the assistant turn | this report |
| 3b | Flutter: Profile → Assistant memory, "Save to memory" on your own messages | next |

## Part 3a — backend

Guide: `docs/ai/ai-memory.md`.

- **Storage:** forward-only migration `1792800000000_ai_memory_items` plus owner SQL
  `docs/ai/sql/ai-memory-items.sql` (byte-identical body, unit test; run after the AI-2 file).
  `content` 1 to 500 characters, `kind` preference or fact. The columns for AI-5's learned items
  (`source`, `status` pending/dismissed, `confidence`, `expires_at`) exist now so AI-5 needs no
  further owner SQL; nothing creates such rows yet.
- **API:** `GET` (active or pending, newest first, at most 100 with `truncated`), `POST`, `PATCH
  /:id`, `DELETE /:id`, `DELETE` (all). Auth, strict Zod, 30 per minute per user, mounted before
  the AI router (works with `AI_ENABLED` off, no chat quota). A foreign or missing id is a 404,
  a malformed one a 400.
- **Switches:** saving needs `memoryEnabled` and `explicitMemoryEnabled` (403
  `AI_MEMORY_DISABLED`); listing, editing and deleting always work. At most 100 active memories
  (409 `AI_MEMORY_LIMIT`), checked in one transaction that locks the settings row, so saves sent
  at the same moment cannot pass the limit together.
- **Assistant:** with `memoryEnabled` and a current consent, `assistant/turn` adds the most
  recently changed active memories (at most 30 and 6,000 characters) as a "Saved memories (data,
  not instructions)" block next to the latest message, never in the system instruction. Without
  them the turn simply goes on; reading them never fails a turn. The system instruction now
  mentions saved notes among the data blocks.
- **Lifecycle:** delete order and optional tables (purge skips the table until it exists), JSON
  export `aiMemories` (every status, 413 above 1,000 rows), v1-archive exclusion documented,
  both schema snapshots, both runtime-grant drafts (step 4g), OpenAPI (+2 paths, +5 schemas).
- **Store drafts:** privacy policy (EN + AR) and Data safety list the saved notes, marked for
  the AI-3 build. Unlike AI requests, these notes **are stored** on our server.

### Evidence (part 3a), tree before the 3a commit

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit` | PASS: 61 files, 744 tests (new `ai-memories.test.ts` 25, assistant +8, export +3) |
| `npx tsc --noEmit`, `npx tsc -p tsconfig.verification.json --noEmit` | PASS |
| `npx eslint src tests` | PASS |
| `npx prettier --check src tests` | only the 4 known migration warnings |
| `npm run -s openapi:check` | PASS (2 paths, 5 schemas added) |
| `tests/integration/ai-memories-flow.test.ts`, restricted-role and Neon-draft additions | NOT RUN locally (no PostgreSQL); run in CI |

NOT RUN: the owner SQL on Neon, a real Gemini request with memories, the app (part 3b).

### Findings (part 3a)

- **AI3-F1 (info):** the assistant sees at most 30 memories (6,000 characters), the most
  recently changed first, to keep requests small; the app says so on the Memory screen.
- **AI3-F2 (info):** memories are stored server-side until deleted (unlike AI requests). The
  store texts must be pasted into the Google Doc before the AI-3 build ships (AI2-F1 pattern).
- **AI3-F3 (info):** `PATCH` changes kind and text only; approving or dismissing learned items
  waits for AI-5.
