# Feature Guide — Phase 0 Audit (2026-11-10)

> **Historical snapshot** — read-only audit of commit `05f7a0414c3b7706b71efdc1ff0851f5b5aaa3d5`
> (`main`, merge of PR #29) taken on 2026-11-10. Every status below describes that
> commit only. Later commits must be re-verified; nothing here is a release verdict.

**Input:** `LifeStyle_Complete_Feature_Architecture_and_Implementation_Guide.pdf` (11 pages),
a companion to "Final Master Prompt v2". The Master Prompt itself was **not supplied**, so the
requirements here come from the guide alone. The guide was written against
`life-style-app-main (9).zip`. This audit used the live Git checkout instead.

**Mode:** Phase 0 is read-only. No product code, migration, dependency or configuration was
changed. The only repository change is this report.

**Evidence vocabulary** (same as the guide and earlier audits): **PASS** = executed on this
SHA and succeeded · **FAIL** = executed and failed · **BLOCKED** = a required tool, service or
device is unavailable · **NOT RUN** = deliberately not attempted. Implementation states:
**PRESENT** / **PARTIAL** / **MISSING**. All are based on opening the files, not on search alone.

---

## 1. Baseline and toolchain

| Item | Value |
| :--- | :--- |
| Commit | `05f7a0414c3b7706b71efdc1ff0851f5b5aaa3d5` (shallow clone: 1 commit visible) |
| Working branch | `arena/db60a1d0-life-style-app`, clean at audit start |
| Local OS / HW | Debian 12, 2 vCPU, 3.8 GiB RAM |
| Local tools present | Node v22.22.3, npm 10.9.8, Python 3.11.2, git 2.39.5, gh 2.23.0 |
| Local tools absent | Flutter/Dart, JDK/Kotlin/Gradle, Android SDK, PostgreSQL, Redis, Docker, physical device |
| Note | CI pins Node 24 and the local run used Node 22 (`engines: >=20`). Local results are supporting evidence. Hosted CI is authoritative for this SHA |

## 2. Gate evidence ledger (E1 baseline)

### 2.1 Executed locally on `05f7a04`

| Gate | Command | Result |
| :--- | :--- | :--- |
| Clean install | `backend: npm ci` | **PASS** (357 packages) |
| Typecheck | `npm run typecheck` | **PASS** |
| Typecheck incl. tests | `npm run typecheck:tests` | **PASS** |
| Lint | `npm run lint` | **PASS** |
| Format | `npm run format:check` | **PASS** |
| Backend unit tests | `vitest run tests/unit` | **PASS** — 49 files, **464/464** |
| Root source-contract suites | `node --test scripts/*.test.mjs` | **PASS** — **171/171** |
| ADR-039 forbidden-dependency guard | `node --test scripts/check-forbidden.test.mjs && node scripts/check-forbidden.mjs` | **PASS** — 21/21 + guard |
| Documentation consistency | `node scripts/check-docs-consistency.mjs` | **PASS** |
| OpenAPI drift | `npm run openapi:generate && git diff --exit-code docs/api/openapi.yaml` | **PASS** (no diff) |
| Worktree secret scan | `npm --prefix tools/security ci && node scripts/scan-secrets.mjs` | **PASS** — 758 files, 0 findings (worktree only) |
| Production advisory gate | `npm audit --omit=dev --audit-level=high` | **PASS** — 0 high/critical; 3 moderate (see §5) |
| Backend integration + security | `vitest run tests/integration tests/security` | **BLOCKED** locally (no PostgreSQL 16 / Redis 7 / Docker) |
| Flutter format / analyze / test | `dart format`, `flutter analyze`, `flutter test` | **BLOCKED** locally (no SDK) |
| Kotlin JVM tests, APK build, signature | `gradlew testDebugUnitTest`, `flutter build apk` | **BLOCKED** locally (no JDK/Android SDK) |

### 2.2 Hosted CI on the same SHA

The step-level results below were read with `gh run view`. Both runs report
`headSha = 05f7a0414c3b…` and `conclusion = success`:
[run 42788971264](https://github.com/KarimOmarShawky/life-style-app/actions/runs/42788971264) (push) and
[run 42793244948](https://github.com/KarimOmarShawky/life-style-app/actions/runs/42793244948) (workflow_dispatch).

| Gate (CI step) | Result |
| :--- | :--- |
| Secretlint worktree scan · Trivy fs HIGH/CRITICAL (enforced) | **PASS** |
| Forbidden-dependency guard · Android build-prep and wallet/money retirement contracts · docs consistency | **PASS** |
| Format, lint, strict TS (src + tests), OpenAPI drift | **PASS** |
| Fresh isolated roles → `migrate:up` twice (idempotency) on PG16 | **PASS** |
| `npm test` — unit + integration + security against PG16 + Redis 7 | **PASS** (the workflow does not print counts) |
| Committed-erasure concurrency · restricted-role sequencing · full migrations on PG18 | **PASS** |
| Production `npm audit --audit-level=high` | **PASS** |
| `dart format` · `flutter analyze --fatal-infos` · `flutter test --coverage` | **PASS** (counts not printed) |
| Kotlin `testDebugUnitTest` | **PASS** |
| Debug validation APK build + signature verification | **PASS** |
| Signed release build | **NOT RUN** (needs `main` + manual dispatch input + android-release secrets) |
| "Isolated backend runtime verification" workflow | **NOT RUN** on this SHA (PR-only trigger; last run was on PR head `512544a`) |
| Physical device, TalkBack, OEM matrix, store review | **BLOCKED** (no device) |
| Load test (k6), p95/p99, EXPLAIN ANALYZE | **NOT RUN** (no harness exists, see E8) |
| Git-history secret scan | Not re-run. Historical **FAIL** (11 Git URI matches, CHANGELOG 2026-10-16). History is not rewritten, per guide rules |

## 3. Feature matrix — E1–E10 and G1–G7

The "Guide class" column uses the guide's own labels. "Recommended phase" is a recommendation
only: the owner decides.

| Item | Guide class | State | Evidence (opened) | Main gap versus the guide's "Done when" | Recommended phase |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **E1** Gates | SAFE | **PRESENT / PARTIAL** | `.github/workflows/{ci,isolated-runtime,security}.yml`; §2 | No per-gate evidence row with counts per SHA (test counts are redirected to logs and never summarised); the isolated-runtime workflow does not run on `main` pushes; local toolchain differs from CI | 1 |
| **E2** Dependencies | SAFE | **PARTIAL** | `backend/package-lock.json`; §5 | No disposition table (fixed / accepted-with-expiry / blocked) and no rotation checklist. Flutter pub advisory scan is BLOCKED here | 1 |
| **E3** Push (FCM) | CAREFUL — needs G2 + ADR + Firebase approval | **PARTIAL (fails closed)** | `backend/src/jobs/job-processors.ts` (`PushSender`, generic content-free text); `backend/src/worker.ts` (permanently-unavailable sender → `PUSH_UNAVAILABLE`); `push_devices` table; `PUT/DELETE /users/me/devices` (`users.routes.ts`) | No provider. The mobile app never registers a token. No token lifecycle, invalid-token cleanup, dedup or metrics. Firebase would need an ADR-039 exception | 2 (after G2) |
| **E4** Onboarding | SAFE (with G1) | **MISSING** | No onboarding code in backend or mobile. First run lands on `TasksScreen` with an empty list (`tasks_screen.dart` empty state has no CTA when no date is selected). `NotificationService.init()` requests notification **and exact-alarm permission at launch** (`notification_service.dart`, called from `main.dart`) | Focus area → starters → one-tap complete → Today; permission only after the first win; skippable; account-scoped `onboarding_completed_at` | 1 |
| **E5** Today-first landing | CAREFUL | **PARTIAL** | App opens Tasks (index 0) with a Daily Briefing card; `DailyPlanScreen` at `/daily-plan`; backend `/day/today`; allowlisted deep links in `lib/navigation/deep_link_parser.dart` (+ `deep_link_parser_test.dart`) | **No feature-flag mechanism exists in the app** (only the `API_BASE_URL` dart-define). No navigation tests for a new landing. Deep links are not device-verified | 2 |
| **E6** Engagement loop | SAFE parts | **PARTIAL** | Habit check-in → snackbar + XP (`habit_card.dart`); task completion → haptic + XP only (`tasks_screen.dart` `_setDone`); weekly review exists (`focus_shield/weekly_review_screen.dart`); widget re-syncs when tasks or XP change (`home_widget_sync.dart`); reflection XP capped once per day | Visible task-completion feedback; weekly-review entry from Today; spam guards beyond the reflection cap | 1 (with G3/G4) |
| **E7** Optimistic UI + bounded queue | CAREFUL | **MISSING (by design)** | Online-first client. Habit check-ins are already idempotent through `UNIQUE (habit_id, checkin_date)` + `ON CONFLICT` | Bounded queue (size + TTL) only for complete/check-in, cleared on logout or account switch, with sync UI. Must **not** become offline-first sync (non-goal, R4) | 2 |
| **E8** Performance | Phase 3 | **MISSING** | No k6 scripts, no EXPLAIN artifacts, no alert definitions | All | 3 |
| **E9** Localization CI | SAFE | **PARTIAL** | 6 catalogs × **603 keys**, **0 missing / 0 extra / 0 placeholder mismatches** (catalogs parsed directly); runtime falls back to English. `l10n_settings_test.dart` only spot-checks 4 keys | **No CI parity or placeholder check**, so drift is possible. Hard-coded English in `routine_wizard_screen.dart` and in `daily_plan_screen.dart` tooltips. ar/en-only ternaries in `profile_screen.dart` and `notification_service.dart` show English to de/es/fr/tr users. Widget strings are English-only (G3). 39 dead money/SMS keys | 1 |
| **E10** Compliance | Phase 3 | **PARTIAL** | Manifest permissions: INTERNET, ACCESS_NETWORK_STATE, RECEIVE_BOOT_COMPLETED, VIBRATE, WAKE_LOCK, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM, MODIFY_AUDIO_SETTINGS, FOREGROUND_SERVICE; Notification Listener ("Focus Inbox") and Accessibility ("Focus Shield") services; `docs/mobile/focus-shield.md`, `digital-detox.md`; the detox status text says it "is not OS package suspension" | No consolidated permission inventory, no iOS memo, no AI production checklist. Full-screen alarm intents and exact alarms are Play-policy-sensitive (see F3) | 3 |
| **G1** First win < 60 s | SAFE | **MISSING** | Same as E4. Quick-add awaits `SmartTaskParser.parseAsync` (AI proxy, **10 s timeout**) before it creates the task (`tasks_screen.dart`, `smart_task_parser.dart`) | 2–3 starters that create real Task/Habit rows **without parser or AI**; skip once; parser-failure fallback | 1 (with E4) |
| **G2** Notification policy | CAREFUL | **MISSING** | No quiet hours, daily cap, digest, global off or tiers anywhere. Reminder channels are `push \| in_app \| email`; `users.timezone` exists. Every timed quick-add task schedules an **insistent full-screen alarm** (`scheduleAlarm`: `fullScreenIntent`, `FLAG_INSISTENT`, `ongoing`, `Importance.max`) | One policy (`allow \| delay \| digest \| drop`) for local and push; tiers; critical only breaks quiet hours by opt-in; DST tests | 2 (before E3) |
| **G3** Home widget | SAFE display / CAREFUL actions | **PARTIAL** | `LifeStyleAppWidgetProvider.kt` shows clarity, level/XP, pending count, **one** top task and native shield status; refreshes every 30 min, on Flutter sync and on `SHIELD_CHANGED`; stale-day fallback; deep links `lifestyle://focus`, `lifestyle://daily-plan` | Next 1–3 tasks; **all widget text hard-coded English** (Kotlin, layout, manifest label); no Kotlin test of widget formatting; process-death deep links not device-verified | 1 (display) |
| **G4** Warm streaks | SAFE copy / CAREFUL engine | **PARTIAL** | API returns `currentStreak` + `longestStreak` (`streaks-engine.ts`). The `Habit` model parses `longestStreak`, but `HabitCard` shows only the current streak. `bestStreakText` / `currentStreakText` exist in all 6 catalogs but are **unused**. The 7-day strip shows dates, not check-in status. No welcome-back copy (only an AI chat greeting). No shame notifications exist | Best streak + weekly consistency + warm copy in 6 languages (copy is SAFE); grace rules (engine, CAREFUL) | 1 (copy) / 2 (grace) |
| **G5** Activation / Day-7 | "CAREFUL · first" in the guide, **but** listed in the Phase 1 SAFE batch | **MISSING** | No `product_events` table, endpoint or definitions. `GET /analytics` is a user-facing summary; `audit_logs` are security events | Content-free events, opt-out, export/delete coverage, definitions doc. **Archive caveat:** the v1 account archive pins section order (`account-archive.sources.ts`), so a new section would make installed clients reject exports. Needs a decision (§6 Q2) | 1 if the owner confirms |
| **G6** Sessions | CAREFUL | **MISSING** | `auth_sessions` already stores `device_platform`, `device_name`, `app_version`, `created_at`, `last_used_at`; only `logout` / `logout-all` exist; Profile has no sessions/devices UI. **ADR-041 intact**: reuse → revoke, covered by `tests/integration/auth-flow.test.ts` and `tests/unit/auth-transactions.test.ts` | `GET /sessions`, `POST /sessions/{id}/revoke` + reauth, separate push-device list, ADR-041 regression | 2 |
| **G7** A11y / RTL gate | SAFE gate | **PARTIAL (weak)** | **0** `Semantics` annotations; 40 `IconButton`s versus 34 tooltips (for example, the habit check-in button has none); 11 non-directional `Alignment.*Left/Right`; 0 `EdgeInsetsDirectional`; 64 fixed `fontSize`s; the nav bar handles text scale > 1.4; no golden tests; task swipe-to-delete hard-codes `Alignment.centerRight` (mirrors wrongly in RTL) | TalkBack labels, 48 dp targets, contrast, 200 % text, directional padding, CI guideline tests | 1 (gate on touched UI) |

## 4. Findings raised by this audit

| ID | Severity | Finding | Evidence | Proposed handling |
| :--- | :--- | :--- | :--- | :--- |
| P0-F1 | **Medium** (privacy) | Timed tasks schedule an alarm whose **title contains the raw task title** (`'Tasks: <title>'`), with no `visibility` setting, so it shows on the lock screen. The guide requires content-free lock-screen payloads | `tasks_screen.dart` (quick-add / add-task submit), `notification_service.dart` `scheduleAlarm` | SAFE-candidate hardening: `NotificationVisibility.private` + generic title. Needs batch approval |
| P0-F2 | **Medium** (privacy / AI) | Quick-add sends the **raw task text to the server AI proxy (Gemini)** on every submit, **without** the per-request egress consent that the AI assistant screen shows | `smart_task_parser.dart` `parseAsync` versus `ai_assistant_screen.dart` (`aiEgressTitle` dialog) | Owner decision (E10 AI checklist): opt-in setting, or local-only parse by default |
| P0-F3 | Low | Every timed quick-add becomes an **insistent full-screen alarm** (loops until dismissed). This is effectively a "Critical" tier with no opt-in or quiet hours, and is Android 14+ full-screen-intent policy-sensitive | `notification_service.dart` | Fold into G2 tiering (CAREFUL) |
| P0-F4 | Low | Quick-add can wait **up to 10 s** for the AI parse before the task is created (it does fall back) | `smart_task_parser.dart`, `tasks_screen.dart` | G1 starters bypass AI; owner decides on the AI timeout |
| P0-F5 | Low | Notification and exact-alarm permissions are requested **at app launch**, before any win | `notification_service.dart` `init`, `main.dart` | E4/G1: move the request to after the first win |
| P0-F6 | Low | Hard-coded English and ar/en-only ternaries bypass the catalogs; widget strings are English-only | see E9 / G3 rows | E9 + G3 in Phase 1 |
| P0-F7 | Low | Accessibility labels largely absent; RTL-unsafe alignments | see G7 row | G7 gate in Phase 1 |
| P0-F8 | Low | 3 moderate production advisories (`glob` GHSA-3g3m-2fjr-6pw4, `minimatch` GHSA-g3hv-75wg-m249 through `node-pg-migrate` 9). npm's suggested fix is a breaking **downgrade** | §5 | E2 disposition |
| P0-F9 | Info | No feature-flag mechanism in the app, but the guide expects CAREFUL items behind flags | `lib/config/app_config.dart` | Compile-time `--dart-define` flags + backend env flags (no remote-config SDK) |
| P0-F10 | Info | 39 dead money/SMS keys in every catalog; `l10n_settings_test.dart` still asserts on retired keys (`money`, `smsSyncTitle`) | catalogs | Cleanup alongside E9 (tests updated together) |

## 5. Dependency snapshot (E2 input)

`npm audit` (all deps) found **9 moderate, 0 high, 0 critical**. Production: `glob` 9.0.0–14.0.1
and `minimatch` 7.0.0–11.0.0, both reached through `node-pg-migrate` (direct dependency). Dev:
`@typescript-eslint/*`, `rimraf` and the same `minimatch`. npm's `--force` fix would install
`node-pg-migrate@7.6.1` and `@typescript-eslint@6.15.0`, which are breaking downgrades, so they
are not taken. Phase 1 will try `overrides` to patched transitive versions behind the full gate
set; whatever remains will be recorded as accepted-with-expiry. Flutter `pub` advisories are
BLOCKED here (no SDK). Hosted `flutter pub get` passed on this SHA.

## 6. Retired-Money check

No user-visible money, wallet, budget, transaction or SMS surface in the mobile app. The only
uses of the wallet icon are for subscriptions, and the AI meal plan's "budget" is a food budget.
`money_repository.dart` calls only `money/subscriptions`. The backend `retiredMoneyGuard` /
`retiredIngestGuard` return **410** for everything except subscriptions and legacy ingest-token
revocation. `scripts/money-retirement-contract.test.mjs` and the wallet SMS contracts pass (part
of 171/171). Subscription renewal reminders are retained. The financial-data erasure migration is
still a **draft outside the migrations directory** (`docs/remediation/drafts/`), awaiting a
separate owner decision that is not part of this guide.

## 7. Guide versus repository conflicts that need an owner decision

1. **G5 classification:** the guide labels G5 "CAREFUL · first" and also places it in the Phase 1 SAFE batch.
2. **G5 export coverage:** a new archive section breaks the pinned v1 archive order. Options: (a) include product events in the JSON `/users/me/export` and document them as an owned archive exclusion (the existing pattern for `password_reset_requests`), or (b) bump the archive version with client support.
3. **P0-F2 (AI egress from quick-add)** and the AI parse timeout (P0-F4).
4. **Feature flags (P0-F9):** compile-time `--dart-define` flags are proposed.

## 8. Proposed Phase 1 (SAFE NOW batch, pending approval)

E1 evidence summary · E2 disposition and overrides · G5 (if confirmed) · E4 + G1 onboarding with
starters and permission after the win · G7 gate on touched UI · G3 display (6-locale widget
strings, 1–3 tasks, empty state) · G4 copy (best streak, warm copy) · E9 CI parity, placeholder and
literal checks · P0-F1 lock-screen hardening. Every new string ships in all 6 locales. Every
change gets an evidence row on its own commit, through a draft PR that triggers hosted CI.
