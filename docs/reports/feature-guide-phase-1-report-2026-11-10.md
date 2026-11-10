# Feature Guide — Phase 1 Report and Handoff (SAFE NOW batch, 2026-11-10)

> **Historical snapshot** — describes branch `arena/db60a1d0-life-style-app` (draft PR #30)
> from `814e274` through code commit `0578fa8` on 2026-11-10. Every status applies to those
> commits only. Re-verify after any later change. This is not a release approval.

**Scope.** The owner-approved SAFE NOW batch from the Phase 0 audit
(`docs/reports/feature-guide-phase-0-audit-2026-11-10.md`):

- E1, E2 and E9.
- G5 on the server and in the app.
- E4 + G1, G3 (display) and G4 (copy).
- G7 on new UI.
- Fixes for Phase 0 findings P0-F1 (lock-screen privacy) and P0-F2 (AI task parsing without consent).

CAREFUL items (G2, E3, G6, E5, E7, streak grace) were **not started**. Each one needs its own owner approval.

**Evidence vocabulary** (as in Phase 0):

- **PASS**: executed on the cited commit and succeeded.
- **FAIL**: executed and failed.
- **BLOCKED**: a required tool, key, service or device is unavailable.
- **NOT RUN**: deliberately not attempted.

**Toolchain limits.** There is no local Flutter/Dart, JDK/Kotlin, Android SDK or device, so Dart and Kotlin are verified only by hosted CI on the cited commits. Backend tests also ran locally, against embedded PostgreSQL 16 and Redis 6.

---

## 1. Verdict

| Question | Answer |
| :--- | :--- |
| Program verdict (guide handoff) | **NO-GO** for a public release, as expected at this stage. Phase 4 is not done: no signed release build, no device matrix, G5 production SQL not applied, and Phases 2–3 not started. |
| Phase 1 batch | Implemented on the branch. On `0578fa8` every hosted CI gate passes (run 42909934455): backend, Dart format, Flutter analyze, Flutter tests, Kotlin JVM tests, and the debug APK build with signature check. |
| Device-only criteria | **NOT RUN**: TalkBack, first win under 60 s, widget on a real home screen, lock-screen display. Owner device pass: `docs/mobile/manual-test-checklist.md`, items P1-1 to P1-12. |
| PR #30 | Still a draft and not merged. Merging is the owner's decision. |

## 2. Owner decisions recorded (2026-11-10)

- The SAFE NOW batch was approved in full: E1, E2, E9, G7 gate, P0-F1, G4, G3 (six languages, next 1–3 tasks), and E4 + G1 with notification permission asked only after the first win.
- G5 was included with the recommended design:
  - Content-free events with an opt-out.
  - Covered by the JSON export and account deletion.
  - Documented exclusion from the v1 archive file, with no archive version bump.
- P0-F2: tasks are parsed on the device by default. AI parsing is available only through an opt-in Profile switch after consent, with a shorter timeout.
- A draft PR is used for hosted CI evidence. Do not merge without the owner's say-so.

## 3. Commit and CI ledger

Each commit has three workflows: **CI Pipeline**, **Isolated backend runtime verification** and **Source secret detection**. The last two succeeded on every commit below. CI Pipeline per commit:

| Commit | Content | CI Pipeline run | Backend gate | Dart format | Analyze | Flutter tests | Kotlin JVM | Debug APK |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `814e274` | Phase 0 report | 42877885770 | PASS | PASS | PASS | PASS | PASS | PASS |
| `3471dc7` | E1, E9, E2 | 42881006000 | PASS | PASS | PASS | PASS | PASS | PASS |
| `b11da4f` | G5 + G1 backend | 42892112519 | PASS | PASS | PASS | PASS | PASS | PASS |
| `e3f26e0` | c1: onboarding, notification privacy, on-device parsing, events | 42901948696 | PASS | FAIL | PASS | FAIL (2 onboarding tests) | not run | not run |
| `fd6a4ac` | c1 CI fixes | 42904371293 | PASS | PASS | PASS | FAIL (Arabic onboarding test) | not run | not run |
| `376da36` | wrong diagnosis (see §5) | 42905273184 | PASS | PASS | PASS | FAIL (same test) | not run | not run |
| `dd2eae4` | test fix, revert of `376da36` | — (pushed together with `d103732`) | | | | | | |
| `d103732` | G3 widget (c2) | 42906847004 | PASS | FAIL | PASS | PASS | not run | not run |
| `b122f11` | format patch | — (pushed together with `8ca9e52`) | | | | | | |
| `8ca9e52` | G4 + G7 habit card | 42908110512 | PASS | FAIL | PASS | PASS | not run | not run |
| `2b867ef` | G7 Profile test | 42908371448 | PASS | FAIL | PASS | FAIL (real overflow, §5) | not run | not run |
| `fc516a2` | format patch | 42908891027 | PASS | PASS | PASS | FAIL (same overflow) | not run | not run |
| `0578fa8` | Profile header fix | 42909934455 | PASS | PASS | PASS | PASS | PASS | PASS |

"not run" means the workflow skips these steps after an earlier failure. Hosted CI does not keep downloadable logs in this sandbox, so failures were read from check-run annotations.

**Local gates on `0578fa8`:**

| Gate | Result |
| :--- | :--- |
| `node --test scripts/*.test.mjs` | 191 tests, 191 pass |
| `node scripts/check-l10n.mjs` | PASS: 647 keys × 6 locales, 16 Android strings × 6 locales, 95 frozen literals |
| `node scripts/check-docs-consistency.mjs` | PASS |
| `node scripts/scan-secrets.mjs` | 803 files, 0 findings |
| `npm run check:forbidden` | PASS |

Backend tests (local, on `b11da4f`): unit 50 files / 490 tests, full suite 701 passed + 2 skipped. The two skipped tests were then run separately and passed. npm audit reported 0 vulnerabilities in backend and in tools/security.

## 4. Phase 1 items against the guide's "Done when"

| Item | Done when (guide) | Built | Evidence | Status |
| :--- | :--- | :--- | :--- | :--- |
| **E1** | Evidence row per gate for the final SHA; signed path identified or blocked. | `scripts/ci-evidence-summary.mjs` (+ tests) writes rows to each job summary: head SHA, toolchain versions, and test counts parsed from runner output ("counts unavailable" rather than a guess). The signed path is the `android-signed-release` job: manual dispatch on `main` only, needs the owner's signing secrets. | The evidence steps succeeded on every run in §3. The rows themselves are on each run's summary page. | Evidence rows **PASS**; signed release build **BLOCKED** (owner key, `main` only). |
| **E2** | Advisories disposed; rotation checklist. | npm overrides: `glob ^14.0.4` (GHSA-3g3m-2fjr-6pw4), `minimatch ^11.0.5` (GHSA-g3hv-75wg-m249), tools/security `fast-uri` 3.1.9. `docs/security/dependency-and-secret-hygiene.md` has the disposition table and a manual rotation checklist. | npm audit reports 0 vulnerabilities (backend, tools/security). | npm **PASS**. Dart/pub advisory scan **NOT RUN** (no OSV tool; OSV-Scanner recommended). No secret rotated (owner action). |
| **E9** | CI fails on drift; RTL recorded; translation notes. | `scripts/check-l10n.mjs` (+ tests) in CI. It fails on missing keys, placeholder drift, Android string or format drift, unescaped apostrophes and new hard-coded literals. Translation notes are in `docs/mobile/flutter-integration.md`. | The CI gate ran on every commit. Arabic RTL widget tests cover onboarding, the habit card and the Profile switches. | **PASS**. Native-speaker review **NOT RUN** (optional owner action). |
| **G5** | Funnel computable; content-free; export, delete and opt-out work. | Server (`b11da4f`): `product_events` table and `POST /api/v1/product-events`. It has auth, a strict Zod body, and per-user and per-IP rate limits. The event set is closed, with one row per user, event and local day. Also: an opt-out on `PATCH /users/me` that deletes existing events, export and deletion coverage, 400-day retention, the `PRODUCT_EVENTS_ENABLED` kill switch, the funnel SQL and ADR-045. App (`e3f26e0`): fire-and-forget client that sends only while the opt-in is on, plus a Profile switch. | 22 unit and 8 integration tests plus the restricted-role replay on `b11da4f`; app tests in `product_events_test.dart`. | Code **PASS**. Production metric values **NOT RUN** (owner SQL not applied). |
| **E4 + G1** | First win in under 60 s with no typing; skip works; denial is safe; measurable. | Onboarding: choose study, work or routine; three starter tasks due today; tick one; celebration; then the reminder question, which can be declined. Skip is offered until the first win, and offline never traps the user. The completion flag is stored locally and on the server. Events record onboarding started, completed or skipped, and task completion. | `onboarding_test.dart` covers the first win without typing, skip, offline, a retry after finishing offline, Arabic at 200% text, and the cold-start link. All PASS on `0578fa8`. | CI **PASS**. Time under 60 s and real OS permission denial **NOT RUN** (device). |
| **G7** (new UI) | TalkBack usable; no clipping at 200%; RTL reviewed; CI prevents regressions. | Tooltips and labels, layouts that wrap, and higher-contrast colours. A real overflow was found and fixed (§5). | `meetsGuideline` tap-target and label checks run for onboarding, the habit card and the Profile switches, plus text contrast for the habit card. Arabic RTL and 200% text are tested on the same screens. All PASS on `0578fa8`. | CI **PASS** for covered screens. TalkBack on a device **NOT RUN**. HomeShell, TasksScreen and FocusTimerScreen have no widget tests (**NOT RUN**). |
| **G3** (display) | Real next actions; language match; deep links survive process death; timely refresh. | Up to three of today's next tasks, chosen Top 3 first. App language with strings in six languages. Path-form links, and cold-start links wait for the session restore. The widget redraws on language, clock and time-zone changes and shows a refresh hint for a stale day. | `home_widget_test.dart`, `deep_link_parser_test.dart` and the cold-start test PASS on `0578fa8`. Kotlin `WidgetContentTest` and the provider compile PASS on `0578fa8`, and the debug APK (layout, strings, manifest) builds. | CI **PASS**. Widget on a device **NOT RUN**. |
| **G4** (copy) | No guilt language; restart path. | Best streak kept visible. A zero streak reads "Start today", or "Fresh start today" after a break. | `habit_card_test.dart` checks the copy states and scans all six languages for guilt words. PASS on `0578fa8`. | **PASS**. Streak grace (CAREFUL) not started. |
| **P0-F1** | Lock-screen and push payloads content-free. | Generic titles and private visibility for all four local notification types; localised action labels. | `notification_privacy_contract_test.dart` PASS. | CI **PASS**. Device lock screen **NOT RUN**. |
| **P0-F2** | No AI parsing without consent. | Parsing runs on the device by default. AI parsing needs the Profile switch plus a consent dialog; 4 s timeout; local fallback. | `smart_task_parser_proxy_test.dart` PASS. | **PASS**. |

## 5. Findings

| ID | Severity | Finding | Status |
| :--- | :--- | :--- | :--- |
| P0-F1 | Medium | Task title on the lock screen | Fixed in `e3f26e0`; device check NOT RUN |
| P0-F2 | Medium | Task text sent to AI without consent | Fixed in `e3f26e0` |
| P0-F3 | Low | Insistent alarm notifications | Open (not in this batch) |
| P0-F4 | Low | Quick add waited on the AI | Fixed in `e3f26e0` (4 s timeout, local fallback) |
| P0-F5 | Low | Permission prompts at launch | Fixed in `e3f26e0` (asked from user actions only) |
| P0-F6 | Low | Hard-coded English | Partly fixed: new UI and the widget are in six languages. 95 older literals are frozen by the ratchet. |
| P0-F7 | Low | Accessibility gaps | Partly fixed (G7 on new UI, habit card, Profile header) |
| P0-F8 | Low | npm advisories | Fixed in `3471dc7` |
| P0-F9 | Info | No feature flags | Open. Opt-ins and the `PRODUCT_EVENTS_ENABLED` kill switch are used instead. |
| P0-F10 | Info | 39 unused money catalog keys | Open |
| P1-F11 | Low | Onboarding steps reused the previous step's scroll position | Fixed in `fd6a4ac` |
| P1-F12 | Low | Widget and notification links in host form (`lifestyle://focus`) reopened home on a warm start | Fixed in `d103732`; older links still accepted |
| P1-F13 | Low | A failed habit check-in threw an unhandled error with no message | Fixed in `8ca9e52` |
| P1-F14 | Low | Profile rank header overflowed by 721 px in Arabic at 200% text | Fixed in `0578fa8` (found by the new G7 test) |
| P1-F15 | Low (truthfulness) | The Profile rank card ("Level 2 • 140 XP", 70% bar, "60 XP to level 3") and the badge unlock states are static placeholders, not the user's real XP or achievements. | **Open, owner decision**: wire it to the XP ledger or remove it. |
| P1-F16 | Info | Profile still has hard-coded Arabic/English text (AI assistant, account deletion), so de/es/fr/tr users see English there | Open; covered by the literal ratchet |

**Process note.** `376da36` blamed PageStorage for the Arabic onboarding test failure; that was wrong, and `dd2eae4` reverted it. The real cause was in the test. `scrollUntilVisible` ends with `ensureVisible`, which moves the list without drawing a new frame. The next tap therefore used the old layout and missed the card. The test now pumps a frame before tapping.

## 6. Security, privacy and Retired Money

**Usage events**
- Events carry only a fixed event name, platform and app version: no titles, notes, IDs or free text.
- Every write is authenticated, validated by a strict schema and rate-limited.
- Turning usage statistics off deletes stored events in the same transaction and stops recording.
- Events appear in the JSON export and are purged with the account.
- Retention is 400 days, and `PRODUCT_EVENTS_ENABLED=false` stops all recording.

**Notifications.** Generic titles with private lock-screen visibility; task titles are never shown on the lock screen.

**AI parsing.** Off by default. Turning it on shows a consent dialog every time. Failures and timeouts fall back to the on-device parser, so tasks and habits never wait on AI.

**Widget**
- Shows the task count, up to three task titles (owner-approved), XP, level and clarity score.
- Never shows messages, senders or package names.
- The receiver is not exported, and sign-out clears the widget.
- Residual risk: task titles are visible on the home screen. A "hide titles" option could follow.

**Dependencies.** No new app dependency: no Firebase, analytics SDK, LLM SDK or widget plugin. Backend dependency changes are npm `overrides` for advisories only. No test library was added.

**Retired Money.** No money, wallet or SMS surface was restored. `scripts/money-retirement-contract.test.mjs` passes within the 191 root tests on `0578fa8`.

**Forward-only migration.** `1792750000000_product_events_and_onboarding.cjs` is additive (a new table and two nullable or defaulted columns). No applied migration was edited.

## 7. Metrics (G5)

Definitions are in ADR-045 and `docs/analytics/product-events.md`; the SQL is in `docs/analytics/sql/product-funnel.sql`.

- **Activation**: a task or habit completion within 30 minutes of signup, reported with the median time to first win.
- **Day N retention (D1, D7, D30)**: a user counts once local day N has ended; users who turned usage statistics off are excluded.

**Values: NOT RUN.** The production SQL has not been applied, and there is no production data access from this environment.

## 8. Changed files

- Footprint: 108 files changed against `05f7a04` at `0578fa8` (+6241 / −324 lines).
- Full manifest: `git diff --name-status 05f7a04..0578fa8`.
- The CHANGELOG section "Unreleased — feature guide Phase 1, 2026-11-10" summarises each part.

| Area | Main paths |
| :--- | :--- |
| CI and scripts | `.github/workflows/ci.yml`; `scripts/ci-evidence-summary.mjs`; `scripts/check-l10n.mjs`; their tests; `scripts/l10n-literal-baseline.json` |
| Backend (G5, G1) | `backend/src/features/product-events/`; users repository, validation and types; `app.ts`, `container.ts`, `worker.ts`, `config/env.ts`; the migration above; `backend/tests/unit/product-events.test.ts`; `backend/tests/integration/product-events-flow.test.ts`; export, deletion and role tests |
| App (Dart) | `mobile-app/mobile/lib/features/onboarding/`; `lib/data/product_events.dart`, `ai_task_parsing_pref.dart`, `notification_service.dart`, `smart_task_parser.dart`; `lib/app.dart`; auth model, repository, provider and Profile; habit card; `focus_shield/home_widget_sync.dart`; six catalogs |
| App (Android) | `WidgetContent.kt` (new) and its JVM test; `LifeStyleAppWidgetProvider.kt`; `MainActivity.kt`; `FocusShieldSessionStore.kt`; `AndroidManifest.xml`; `res/layout/lifestyle_widget.xml`; `res/values*/widget_strings.xml` and `strings.xml` |
| App tests | `onboarding_test.dart`, `product_events_test.dart`, `notification_privacy_contract_test.dart`, `habit_card_test.dart`, `profile_controls_a11y_test.dart`, `home_widget_test.dart`, `deep_link_parser_test.dart`, `smart_task_parser_proxy_test.dart` |
| Docs | ADR-045; `docs/analytics/`; `docs/security/dependency-and-secret-hygiene.md`; `docs/api/account-archive.md`; `docs/database/migrations.md`; `docs/development/environment.md`; `docs/mobile/` (focus-shield, flutter-integration, manual-test-checklist); `docs/remediation/`; both feature-guide reports |

## 9. Rollback

- **App:** each part is a separate commit and can be reverted on its own. AI parsing is off by default, and usage statistics can be turned off per user. The widget still accepts the old link form.
- **Server:** `PRODUCT_EVENTS_ENABLED=false` stops event recording. If the table is missing, the endpoint answers `recorded: false` and the app carries on.
- **Database:** forward-only. To back out, keep the additive schema and use the kill switch. Do not write a down migration on Neon.

## 10. Owner actions

1. After merge and deploy, run `docs/analytics/sql/product-events-and-onboarding.sql`, first on a Neon branch with its verification queries, then on production. Never run `npm run migrate` against Neon.
2. Decide whether to merge PR #30.
3. Update the Play Data safety form: "App interactions", collected for Analytics, optional, user can stop and delete. Update the privacy policy to match.
4. Run the device pass in `docs/mobile/manual-test-checklist.md` (P1-1 to P1-12): TalkBack, largest font, Arabic, widget, lock-screen notifications.
5. Optional: have native speakers review the new strings.
6. Decide P1-F15 (placeholder rank card).
7. Approve or decline each Phase 2 CAREFUL item individually: G2 → E3, G6, G4 streak grace, E5, E7.

## 11. Device matrix and store checklist (NOT RUN)

**Suggested matrix**

| Area | Coverage |
| :--- | :--- |
| Android versions | Android 8 (API 26) on a small screen, Android 14, and the newest available |
| Devices | One Pixel and one Samsung (One UI) |
| Settings | English and Arabic; largest font size; TalkBack |
| Conditions | Battery saver on; app force-stopped before link and widget taps |

**Store checklist**
- Signed AAB built with the owner's key from `main`.
- App version bumped from `1.0.1+1` in `pubspec.yaml`.
- Data safety and privacy policy updates (§10).
- Screenshots in both languages if store listings change.
