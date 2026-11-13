# Hybrid AI slice AI-P and release preparation — report (2026-11-12)

> **Historical snapshot** — work on branch `arena/04c63949-life-style-app` (draft PR #32),
> started from `main` at `18d9172`, 2026-11-11/12. Evidence below is tied to the cited
> commits. This is not a release approval: device behaviour, the production SQL, the signed
> build and the Play Console submission are NOT RUN here. The AI-P owner SQL is **not
> applied** at the time of writing.
>
> **Update (2026-11-13, owner-reported):** the AI-P, AI-2 and AI-3 owner SQL files are applied on
> production, after a rehearsal on the Neon branch `ai-rehearsal`.

Source: `LifeStyle_Complete_Master_and_Hybrid_AI_Reference.pdf`, Part I (AI-0…AI-6), and the
AI-0 audit `docs/reports/hybrid-ai-ai0-audit-2026-11-11.md`. Owner context: AI is the top
priority; personal Play account (closed test, 12+ testers for 14 days); testers use AI from the
first closed-test build; "do all agent-side work now" (2026-11-11) and "continue" (2026-11-12).

## 1. Scope and decisions used

- AI-P = AI0-F2 (in-app report of AI replies, Play AI-Generated Content policy), AI0-F1
  (long-chat failure) and AI0-F11 / D9 (18+ confirmation, Gemini API terms).
- D1 applied as recommended (reply text included when ticked, on by default; reason, note;
  90 days; owner read query). D0–D9 remain recommendations; the owner has not confirmed them
  explicitly. AI-1 does not start before the owner's go-ahead.
- Release prep: App Bundle in the signed job, privacy policy and Data safety drafts, tester
  guide, device checks.

## 2. Verdict

AI-P is complete on the agent side and green in hosted CI at `ac26096` (the final commit's CI
is cited in PR #32). **NO-GO for public release** until the items in section 7 are done by
the owner; nothing here was run on a phone, against production or in Play Console.

## 3. What changed

**Backend (`e1bfc6c`).** `POST /api/v1/ai/reports`: strict body `{surface, category,
replyText? ≤ 4,000, note? ≤ 500, locale}`, auth, 10 per hour and 30 per day per user, 201
`{reported: true}` with `no-store`; works with `AI_ENABLED=false`; 503
`AI_REPORTS_UNAVAILABLE` until the owner SQL runs. Table `ai_content_reports` (forward-only
migration `1792780000000`, owner SQL `docs/ai/sql/ai-content-reports.sql`), 90-day nightly
purge (03:55), JSON export key `aiContentReports`, erased with the account, v1-archive
exclusion, grants in both runtime-role drafts, OpenAPI. Guide: `docs/ai/ai-content-reports.md`.

**App (`0eb27e5`, `7864e30` and the final commit).**
- Report button (flag, tooltip "Report reply", 48 dp) on finished assistant replies (also
  restored ones; not the greeting), on weekly coaching only when the AI wrote it, on analytics
  insights only when the AI wrote it. Sheet: five reasons, "Include the reply" (on), note ≤ 500,
  Cancel / Send report (disabled until a reason); success snackbar; any refusal keeps the sheet
  open with a message announced to screen readers.
- Long chats (AI0-F1): `boundedAiHistory` sends only the newest answered turns that fit the
  server contract (≤ 20 earlier turns, ≤ 4,000 UTF-16 units each, ≤ 24,000 in total including
  the new message; empty and unanswered turns skipped). Input capped at 4,000 characters. The
  phone still keeps 100 messages.
- 18+ (AI0-F11 / D9): `ensureAiAgeConfirmed` before the assistant send, weekly coaching,
  analytics insights and turning on AI help for Smart Quick Add; once per account on the phone;
  declining stores nothing and sends nothing. `aiEgressDescription` rewritten (Google Gemini via
  LifeStyle's server; no personal API key).
- Final commit: AI help for Smart Quick Add counts as off for an account that turned it on
  before this build until it confirms 18+ (tasks are then parsed on the device, never blocked).
- 18 strings × 6 languages (`check-l10n` 732 keys × 6 at `0eb27e5`).

**Release (`ac26096`).** The explicit, main-only `android-signed-release` job also runs
`flutter build appbundle --release --obfuscate --split-debug-info=…/lifestyle-bundle-symbols`,
verifies the bundle with the JDK (`scripts/verify-android-aab.mjs`: `jarsigner -verify`, then
`keytool -printcert -rfc -jarfile`; exactly one signer equal to `ANDROID_RELEASE_CERT_SHA256`,
never the debug identity; fixed-stage diagnostics only) and uploads
`lifestyle-android-signed-bundle` and `lifestyle-android-bundle-symbols` (7 days). The APK
artifacts are unchanged. Secret-triage provenance chain updated for `ci.yml` (SR-07/SR-08).

**Store drafts (final commit).** `docs/store/privacy-policy-draft.md` (English and Arabic),
`docs/store/data-safety-draft.md` (Data safety and App content answers, account-deletion
page text), `docs/store/closed-test-tester-guide.md` (Arabic and English, AI scenarios).
Device checks AIP-1…AIP-9 in `docs/mobile/manual-test-checklist.md`.

## 4. Evidence

| Commit | Check | Result |
| :--- | :--- | :--- |
| `e1bfc6c` | Backend prettier `--check`, eslint, `tsc --noEmit`, `tsc -p tsconfig.verification.json`, unit tests, `openapi:check`; root gates | PASS (local, at that commit) |
| `e1bfc6c` | CI Pipeline 43122990475; isolated runtime 43122990379; secret detection 43122990367 | success (signed build skipped) |
| `0eb27e5` | CI Pipeline 43125168268 | **failure**: Flutter job only (see AI-P-F1, F2); backend gate success |
| `0eb27e5` | Isolated runtime 43125168270; secret detection 43125168413 | success |
| `ac26096` (with `7864e30`) | CI Pipeline 43126268779: Flutter static analysis, Flutter tests, Kotlin JVM tests, debug validation APK build and signature check, backend gate, SDK verifier fixture | success (signed build skipped: no `android-release` environment) |
| `ac26096` | Isolated runtime 43126268896; secret detection 43126268728 | success |
| working tree after `ac26096` (backend identical to `e1bfc6c`) | `npx vitest run tests/unit` | 56 files, 618 tests PASS (local) |
| same | `npx tsc --noEmit`; `npm run -s openapi:check` | PASS (local) |
| final commit (tree as committed) | `node --test scripts/*.test.mjs` 195/195; `check-l10n`; `check:forbidden`; `check-docs-consistency`; `scan-secrets` (872 files, 0 findings) | PASS (local) |
| final commit | hosted CI | cited in the PR #32 body (not known when this report was written) |

Not available locally: Dart, Flutter, a JDK. All Dart/Flutter and Kotlin results come from
hosted CI. `scripts/verify-android-aab.mjs` is tested with parsing fixtures (public root
certificates from Node); it has never run against a real bundle.

## 5. Findings from this slice

- **AI-P-F1 (fixed in `7864e30`, found by CI).** The first 18+ helper awaited
  `ref.read(provider.future)` on a notifier that watched the account. When the account resolved
  after that read and nothing listened to the notifier, the future never completed, so the
  dialog never opened (two widget tests). A screen opened while the account is still loading
  could have hit the same wait. The helper now reads the account and the stored flag directly.
- **AI-P-F2 (fixed in `7864e30`).** The client test imported `MemoryTokenStore`, which exists
  only inside `test/api_client_test.dart`; the 200 % sheet test measured tap targets after
  scrolling, when chips are clipped by the scroll view. Own fake; buttons measured directly.
- **AI-P-F3 (fixed in the final commit).** Accounts that enabled AI parsing before the 18+
  question existed kept using it without confirming. Test `test/ai_task_parsing_age_test.dart`.
- **AI-P-F4 (owner, Play, release blocker).** Focus Shield declares an AccessibilityService.
  Play requires the Accessibility API declaration (not an accessibility tool) with a short
  video. Draft answer in `docs/store/data-safety-draft.md`.
- **AI-P-F5 (owner, Play, release blocker).** Play's User Data policy asks for the privacy
  policy in Play Console **and inside the app**. The app has no link today, and opening a URL
  needs either a new dependency (`url_launcher`, ADR-039) or a small Android intent in the
  existing platform channel. Owner decision needed (see section 8).
  *Update 2026-11-12:* decided (Android intent) and implemented on this branch: Profile →
  Privacy policy, link from the `android-release` variable `ANDROID_PRIVACY_POLICY_URL`.
- **AI-P-F6 (owner).** The Data safety answer "shared with Google" depends on the Gemini
  billing tier: unpaid = shared (Google may use the content), paid = processed on our behalf.
- **AI-P-F7 (owner).** The 12-month security-log deletion runs only when
  `DATABASE_MAINTENANCE_URL` is set on Railway; otherwise the privacy policy statement is wrong.
  Not verifiable here.
- **AI-P-F8 (info).** With Play App Signing the `android-release` key is the upload key; the
  version code (`1.0.1+1`) must rise for every upload.

## 6. Files

Backend: `backend/src/features/ai-reports/*`, migration `1792780000000_ai_content_reports.cjs`,
`docs/ai/sql/ai-content-reports.sql`, `docs/ai/ai-content-reports.md`, tests
`backend/tests/unit/ai-reports.test.ts`, `backend/tests/integration/ai-reports-flow.test.ts`.
App: `lib/features/ai/data/{text_limits,ai_reports_client,ai_age_confirmation,ai_transport}.dart`,
`lib/features/ai/presentation/ai_report_sheet.dart`, `lib/data/ai_task_parsing_pref.dart`, the
assistant, weekly review, analytics and Profile screens, `lib/l10n/*`; tests
`test/ai_history_window_test.dart`, `test/ai_reports_client_test.dart`,
`test/ai_report_sheet_test.dart`, `test/ai_task_parsing_age_test.dart`.
Release: `.github/workflows/ci.yml`, `scripts/verify-android-aab.mjs`,
`scripts/android-bundle-verification.test.mjs`, `docs/remediation/secret-triage.json`,
`docs/mobile/build-preparation.md`. Store: `docs/store/*`. Checklist and log:
`docs/mobile/manual-test-checklist.md`, `CHANGELOG.md`.

## 7. Still NOT RUN / owner order

1. AI-P SQL on a Neon branch of production, verification queries, then production.
2. Owner says "merge" → PR #32 merged → Railway deploys `main`.
3. Gemini billing (or the unpaid closed-test fallback), then Railway `AI_ENABLED=true` and
   `GEMINI_API_KEY`.
4. Upload key and the `android-release` environment (secrets and variables per
   `docs/mobile/build-preparation.md`); run the CI Pipeline on `main` with
   `build_signed_release`; download `lifestyle-android-signed-bundle`.
5. Publish the privacy policy and the account-deletion page; fill in the Play Console App
   content (Data safety, 18+ target audience, Accessibility declaration, app access account).
6. Closed testing release with the bundle; 15–20 adult testers; 14 days.
7. Device pass: AIP-1…AIP-9 plus the earlier P1, G2, G6 and G7 checks; onboarding backfill SQL.

## 8. Next decisions for the owner

- Go-ahead on D0–D9 to start AI-1 (provider-neutral interface plus the Gemini adapter; fixes
  AI0-F3 system prompt, AI0-F5 safety settings, AI0-F6 validator; D6 removes unused methods).
- AI-P-F5: how the app opens the privacy policy (Android intent through the existing platform
  channel, recommended; or `url_launcher` with an ADR).
- Still open from earlier: G6-F1, A2-F1, A2-F3, A1-F1 and the material_ui migration timing.
