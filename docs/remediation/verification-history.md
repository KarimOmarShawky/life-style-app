# Verification iteration history (not additional final-gate counts)

Only actual executions are recorded. Final reconciled gate outcomes are in checks.json.

- Baseline: `git status --short` empty; `git branch --show-current` reported
  `arena/3f871eac-life-style-app`; `git diff --stat` empty. No reset/clean/checkout,
  branch switch, commit, push or user-data cleanup was performed.
- Baseline test configuration read before any tests: hard-coded development DB,
  Redis0, DELETE users / FLUSHDB in integration hooks. None of those suites ran.
- `npm ci --no-audit --no-fund` (backend): PASS; network registry was available.
  `npm install nodemailer --save --no-audit --no-fund` and
  `npm install @types/nodemailer --save-dev --no-audit --no-fund`: PASS.
- First post-edit `npm run typecheck` and `npm run test:unit` (backend): PASS;
  167 unit tests initially; later 168, 193, 194, 197 and 198 at the prior snapshot as targeted
  regressions were added. These are not unmodified-baseline results.
- `npm --prefix backend run format:check`: initially FAIL (18 modified files).
  Prettier on changed backend sources corrected it; final check PASS.
- Scratch WASM dart_style parse: initially FAIL on a missing CheckboxListTile
  closing parenthesis in the new Detox selection dialog. Corrected; all 16 changed
  Dart files parsed at that snapshot. This is not a Dart compiler or Flutter test result.
- `backend/node_modules/.bin/tsc -p backend/tsconfig.verification.json` (equivalent
  cwd/backend invocation was used): initial FAIL with 22 strict test-source errors,
  including two in newly changed tests. Fixed missing type import, optional-user
  assignment and focused existing input narrowing/unused test variable issues.
  No strictness flag was relaxed. Final source+test typecheck PASS.
- `node scripts/check-forbidden.mjs`: consistently FAIL after correcting the path;
  three real file_picker manifest/lock violations remain. No blanket allowlist added.
- Initial expected-refusal probe `npm --prefix backend exec -- vitest run
  tests/integration/health.test.ts` ran Vitest from repository root, bypassing the
  backend runner config. It failed for missing environment variables before tests,
  not for the intended guard. This was NOT recorded as a passing safety test.
  This exposed a safety gap: direct suite imports could bypass setup. Added a
  first-import safety guard to every integration/security suite and a unit inventory
  guard. Corrected probe (`cd backend && ./node_modules/.bin/vitest run
  tests/integration/health.test.ts`) now refuses at import/setup before cleanup.
- Final dependency audit: PASS, zero production vulnerabilities reported.
- PDF tooling: `pdftotext` absent. Isolated Python venv with pypdf/reportlab used
  to read the supplied report and generate/check deliverables. No application
  Python dependencies added. Scratch @wasm-fmt/dart_fmt@0.4.0 is not a mobile
  or backend runtime dependency.

No integration, security, real migration, Docker, Flutter, Android build, real SMTP
or device restriction test has succeeded in this environment. They remain BLOCKED.
No synthetic infrastructure result is represented as a live-service PASS.

## Continued implementation after progress update
- Added current-password reauthentication for export/deletion with dependent Flutter
  calls, API schema and shared rate limiter. First compile identified a missing
  ErrorCode union member; added the actual error code (no cast/bypass). Source+test
  compilation and 202 tests across 24 files then PASS.
- Removed monetary double arithmetic from the money overview/clipboard report,
  grouped totals by currency, and used server monthly-equivalent strings for active
  subscriptions. Added pure integer-scale regression tests; Flutter execution remains
  BLOCKED. No persisted financial records were changed.
- Dependencies were reinstalled after sandbox snapshot restoration (node_modules
  is intentionally not persisted). No application data services were created.

- Final continued gates re-run after reauthentication/money changes: C01-C09 PASS,
  C10 FAIL (file_picker), C11 refusal PASS, C12 syntax-only PASS, C13 diff PASS.
  Added dialog-owned controller disposal and English catalog fallback plus two
  widget tests (NOT RUN); these are not mobile execution evidence.
- First packaging inventory correctly refused an omitted historical deletion
  (backend/src/jobs/email-queue.ts). Explicit deletion inventory and apply guide
  corrected to include it; no repository or user data was deleted by packaging.
- ZIP/PDF/manifest packaging PASS: 149 repository-relative source files and four
  reviewed deletions, 45 PDF pages. An additional scratch manifest verifier first
  FAILed its row-count assertion because it skipped two rows although only one
  header matched its filter; corrected the verifier to skip one header. This was
  a scratch verifier parsing error, not a source/ZIP hash mismatch. All paths/hashes
  and PDF page text bounds were checked again after regeneration.

## Additional user-requested hardening after delivery
- Reinstalled snapshot-excluded dependencies and report/syntax tooling. No user
  data service or destructive test was started.
- Audited the real logger, limiter, export UI and contracts. Added fail-closed
  sensitive calls while preserving general availability policy; atomic Redis
  increment/TTL and exact memory expiry; Cache-Control no-store. Replaced ad hoc
  logger tests with actual production output/async-context/body-redaction tests.
- Targeted units PASS: 19 tests / 3 files. Strict test compilation PASS; full
  backend units PASS: 213 tests / 24 files (11 net new tests vs prior delivery).
- Removed automatic account export clipboard write; added explicit consent and
  four widget tests (NOT RUN). WASM parser PASS on 26 changed Dart files only.
- These changes do not close B-18 streaming, actual Redis/native verification,
  retention, file_picker policy or CI scanner gaps. No audit-ID count inflation.

## Continued work: transactions, real source scanning and export accuracy
- First transaction regression probe FAIL: 10 failed / 8 passed (18 tests) before
  source correction. Fixed register/login/refresh, then inspected and corrected
  the same lifecycle in logout/logout-all/reset/change-password. Final 37 targeted
  units PASS. These use controlled dependencies, not PostgreSQL concurrency.
- Initial source scanner self-test FAIL exposed a genuine upstream short PKCS#8
  Ed25519 heuristic gap; supplemented with a parseable-key rule rather than
  suppressing the probe. Custom-rule path resolution, source config inventory
  omissions and a non-secret AWS ID probe also failed closed during iterations.
  Corrected resolution/STDIN coverage and used an actual synthetic secret pattern.
  Final Ed25519/RSA/JSON/AWS positive + public/benign negative probes PASS.
- Current-source scanner actually runs and FAILs on 18 connection-string patterns
  in examples, CI, compose/helper scripts. No allowlist or raw matching values.
  Tool dependency audit PASS: zero reported vulnerabilities. Hosted CI NOT RUN.
- Scoped export queries and truthful metadata-only UI/API disclosure; two repository
  SQL-harness units PASS. Full backend suite PASS: 252 tests / 26 files, 39 net new.
  Flutter source changes remain syntax-only / runtime BLOCKED. No data services,
  migrations, destructive tests, credentials or permissions were changed.
- A metadata-update Python snippet initially FAILed syntax parsing before making
  any writes; corrected it. Application verification still ran independently and
  captured final gates, including actual C25 detection FAIL rather than PASS.

- Final continued verification additionally covered last-login transaction routing:
  use the active client for the login timestamp, preserving optional-client callers.
  Two additional units PASS. Final full C06 PASS: 254 tests / 26 files. C01-C09,
  C11-C13 PASS; C10 file_picker FAIL and C25 source detection FAIL (18 patterns)
  are retained. Final packaging records C14 separately. No live-service result.

## User-authorized per-match review of the 18 source findings
- Checked every original file/line against the committed role-bootstrap values:
  18 exact local/default matches; no live-server or ignored-secret inspection.
  Recorded metadata-only provenance and before/after source hashes in
  secret-triage.json. Production reuse/rotation remains BLOCKED, not disproved.
- Found two dangerous helper paths: implicit setup/migration with suppressed errors
  and default down/up against development. Replaced with non-mutating preflight,
  default safe unit checks and explicit isolated forward-only verification.
  No actual infrastructure commands were executed; helper control-flow tests use
  command spies with blocked service binaries and owned temporary directories.
- Added production guards for public database passwords in three URI settings,
  percent/query forms, safe parse diagnostics and effective query-user identity.
  26 new backend regressions PASS. Full C06 now PASS: 280 tests / 27 files.
- Bound local PostgreSQL/Redis/Mailpit host ports to loopback in both Compose
  sources; parity/binding assertions PASS, Docker/network runtime BLOCKED.
- C25 detector probes still PASS, actual source scan remains FAIL: 16 retained
  defaults (two helper literals removed). No exclusions/rule weakening. C26 PASS:
  17 standalone helper/config/provenance/Compose source tests, separate from C06.
- Final safe gates: C01-C09, C11-C13 and C26 PASS; C10 file_picker and C25 source
  patterns FAIL; live infrastructure/native/device gaps remain BLOCKED/NOT RUN.
  Packaging C14 checks final byte/hash inventories separately. No commit/push.

## User-authorized fresh-local random credentials (2026-10-15)
- Replaced remaining tracked application-role URI defaults with a coherent
  fresh-local generator, required Compose settings, transactional fresh bootstrap
  and per-job masked CI role environment. Six independent local 32-byte values,
  private ignored files and random project scope; no credential values logged by
  the local helper. Public ephemeral CI administrator fixture intentionally remains.
- Generation refuses existing environment/setup paths and symlinks. Loader validates
  private owner/modes/schema/URLs/shared keys. Wrapper pins project/file/env/local
  Unix socket, strips ambient Compose/local overrides, and suppresses raw Docker
  output. There is no down/delete/rotation command. Existing installations need an
  approved backup/rehearsal/coordinated operator plan, not regenerated files.
- First 21 temporary-filesystem/command-spy/CI-file/source tests PASS; added a real
  local-generator CLI no-secret-output test. Final C27: 22 tests PASS. Updated C26
  to preserve all 18 historical records, earlier 16 retained outcomes and old hashes,
  while validating new current-source fingerprints. Final C26: 17 tests PASS.
- First new actual detector scan PASS: 538 files, zero findings; after documentation
  additions, full C25 PASS: 539 files, zero findings, positive/negative probes PASS
  and tooling audit zero reported vulnerabilities. Final C25 evidence is refreshed
  after the new C27 evidence file is present; its own count is authoritative. No
  detector exclusions or rule weakening. Earlier 18/16 FAIL results remain history.
- Full safe verification executed again: backend 280 tests / 27 files PASS,
  typechecks/lint/format/build/OpenAPI/audits PASS, expected unsafe-test refusal PASS.
  C10 still FAIL (three file_picker hits); Docker/PostgreSQL/native/device checks
  BLOCKED and E2E/hosted/history/image checks NOT RUN. Packaging C14 is a separate
  executed gate, not inferred from the verifier's overall exit code.
- No generator ran against the real repository, no actual Docker/database service
  command or migration ran, no existing secret/role/volume was changed. Child-process
  tests generate only disposable credentials in owned temporary directories.
  Partial-write and first-PGDATA-failure recovery are documented without automatic
  cleanup. Private configuration is explicitly refused by the source packager,
  even if force-added to Git; source ZIP/PDF/manifest are regenerated separately.

## User-authorized development beyond tests: streamed export and isolated runtime gate
- Inspected actual repository/schema, export DTO/service/controller, sensitive-action
  controls, destructive suite hooks and workflows before changing code. Docker,
  PostgreSQL, Flutter/Java tools remain absent. Reinstalled snapshot-excluded npm,
  Python report and scratch WASM tooling; did not contact an application service.
- Added an additive backend domain-archive route with explicit projections over 21
  sections, decimal strings, soft-deleted rows and disclosed security/infrastructure
  exclusions. Read-only repeatable snapshot/cursors, bounded pages/row/whole-file/time/
  process capacity, backpressure, abort and checked-out pg error handling; completion
  count/byte/hash footer only after commit/generation audit. Existing metadata route
  retains its shape below 1000 rows per list, rejects overflow rather than truncates.
- Initial archive harness: 20 PASS / 1 FAIL, plus strict-test compilation FAIL for an
  incomplete password-hasher fixture. Failure exposed validation incorrectly mapped
  to 503 instead of 400. Preserved Zod validation handling and completed the fixture.
  One attempted correction used backend-relative paths from backend cwd and made no
  writes; the old test FAIL repeated. Corrected from repository cwd; targeted 27 PASS.
  Added async client-error, stalled-audit abort and legacy overflow regressions;
  final C06 is authoritative for all passing backend tests. No false infrastructure
  success inferred from the SQL/HTTP/response-spy harness.
- Added independent hosted runtime workflow with trusted job service-ID/image/network/
  port verification before bootstrap, repeat migrations and existing-role refusal,
  then integration/security suites. Sixteen local command-spy/negative/source tests
  PASS; hosted execution NOT RUN. Existing file_picker/policy workflow is unchanged.
- Authored two live PostgreSQL archive tests and one users-flow HTTP/deletion-grace
  archive test; NOT executed here. No actual Docker/database setup, credentials,
  migration, deletion or reset occurred. Native archive parser/save UX and verified
  secure-file storage are still unimplemented; current mobile metadata UX remains
  truthful. No policy decision, retention change, new native capability, commit/push
  or broad cleanup was performed. Final source/PDF/manifest are regenerated after
  the safe verification gates, preserving 57 records/37 overlap groups and blockers.
- Final executed safe verification for this batch: C06 PASS, 306 backend tests /
  28 files (26 additional tests vs the prior 280-test delivery); C26/C27/C28 PASS,
  respectively 17/22/16 standalone tests (55 total, no real service invocation).
  Compilation/lint/format/build/OpenAPI/audits/expected unsafe-test refusal PASS.
  The authored workflow also parsed as YAML using installed Prettier (syntax only,
  not GitHub semantic/execution proof). C10 remains FAIL; runtime/native/device
  gates remain BLOCKED and hosted/history/image/E2E NOT RUN. Final C25 source scan
  evidence and C14 packaging/independent byte checks are refreshed separately.

## Next authorized step: Android streamed-archive integration (source, scoped JVM proof)
- Inspected actual API/auth/profile/backup/native code and the backend wire contract.
  Added strict incremental UTF-8 NDJSON validation, dedicated bounded/cancellable
  transport with one explicit expiry refresh, and separate password/consent/download/
  verify/save actions. Existing metadata/optional clipboard flow is preserved.
- Added Android-only encrypted chunk staging and SAF destination consent/readback,
  opaque IDs, noBackupFilesDir, in-memory key, owned orphan cleanup and expiry.
  No new permission, plugin, accessibility/device-admin capability, file_picker waiver
  or retention policy was introduced. Unsupported platforms remain explicit.
- Restored scratch npm/Python tools outside source and added scratch Java17/Kotlin
  compiler. Java was unavailable in earlier batches; it is now present ONLY for
  Android-free staging checks. Flutter/Dart and Android SDK remain absent. No real
  bridge/provider/lifecycle/device behavior or release build is certified.
- `node --test scripts/archive-mobile-contract.test.mjs`: 8 PASS; synthetic wire
  fixture/hash/counts and source consistency only, not Dart runtime execution.
- `python scripts/check-archive-stage.py`: 10 PASS on the actual Kotlin class with
  real JVM AES-GCM and temporary encrypted-file I/O. An added EOF-time revocation
  probe initially FAILed after eight cases: readback could return matching EOF after
  revocation during a blocking read. Added a final checkActive in verifySaved; the
  same regression now PASSes within the ten-check suite (10 total named cases).
  Bridge additionally checks provider cancellation before cleanup/saved reply; this
  Android-specific change is source-only, not compiled/executed against Android.
- Added 25 Flutter cases (13 protocol/coordinator, nine transport, three widgets),
  all NOT RUN. Fake injectable HTTP/staging objects exist only in authored tests,
  not as production fallback. A formatting-only brace edit briefly failed syntax
  parsing; corrected that callback and reran the full WASM parser: 34 changed Dart
  files PASS, syntax only. No Dart analyzer/dependency-resolution PASS inferred.
- Scoped raw outputs are C29/C30. C19-C22 remain BLOCKED, C10 file_picker FAIL is
  intentionally preserved, and hosted/history/image/E2E execution remains NOT RUN.
  The source detector, full safe backend/helper gates and packaging are refreshed
  for this batch; their final logs/checks.json/report, not earlier totals, govern.
- Provider readback does not establish cloud durability, secure erasure or backup
  exclusion of the chosen plaintext destination. Failed/cancelled provider I/O can
  leave an empty/partial document. Cancellation/ten-minute expiry are best effort
  during noncompliant blocking I/O; only owned private stages/new selected documents
  are cleanup targets, not application/user records. See docs/mobile/account-archive.md.
- No service/database/device contact, migration, destructive integration/security
  execution, commit/push/deployment or user-data cleanup was performed. Preserved
  57 records/37 overlap groups and conservative partial/unverified dispositions.

## Owner clarification: permit local audio, keep server file uploads forbidden
- The user explicitly clarified that the ban concerns server uploads to avoid leaks,
  after the agent explained the existing local Focus Timer audio picker. Recorded
  the current authorization, not an invented historical approval, in architecture
  and docs/security/local-audio-boundary.md. Prior C10 FAIL results above remain history.
- Reviewed actual picker, local preferences, device-file player, manifest/lock, guard,
  JSON middleware and middleware mounting order. No upload call was identified in the
  current Dart picker/preference/playback flow. This is not inspection/certification
  of all plugin internals, device traffic, backups or every app integration.
- Permitted only reviewed existing mobile dependency/lock entries and the single
  audio-only consumer. No global file_picker allowlist or mobile version/feature/
  permission change. Added conservative consumer checks, metadata-only diagnostics
  and fail-closed policy parsing. Server upload production-dependency bans remain;
  no API route or production middleware behavior was changed. Corrected misleading
  ADR-008 storage label (the actual ADR concerns UUIDs).
- `node scripts/check-forbidden.mjs` now PASSes the clarified policy. C31 runs
  `node --test scripts/check-forbidden.test.mjs`: 21 PASS, including actual CLI
  copies in owned temporary source fixtures. Forbidden server dependencies/new
  picker consumers, broader selection and invalid policy are rejected. These are
  policy/source/CLI tests, not native runtime or no-leak certification.
- Added 13 real Express middleware HTTP regressions: POST/PUT/PATCH multipart/audio/
  octet-stream rejection before an endpoint handler, JSON acceptance and size limit.
  Strict test compilation PASS. The attempted focused npm unit command included the
  existing directory filter, so it actually ran ALL 319 units / 29 files: PASS.
  No fake upload success, saved user file, application service, DB/Redis or device
  was used. Fixture cleanup is limited to each harness's own temporary directory.
- Registered C31, included its tests in existing CI steps (hosted execution NOT RUN),
  and refreshed safe verification/source patch/PDF/per-file hashes. B-15 now has
  targeted fixed_verified scope; native/runtime limitations remain separate. All
  57 source records/37 groups and unrelated changes are preserved. Retention and
  other unresolved policies are not changed by this clarification.
- C10 PASS must not be described as proof of absent data leaks. Structured JSON is
  still a supported API payload, OS choosers may expose cloud-backed providers, and
  real Flutter/native picker/playback/network verification remains BLOCKED. Existing
  infrastructure/device and hosted/history/image/E2E limits remain unchanged.
- The first full safe rerun after adding the CI regression-test command had C26
  FAIL (16/17): the unchanged provenance test detected the workflow's stale current
  SHA-256. Verified that reverting ONLY the new guard-test command reproduces the
  recorded prior fingerprint; retained that fingerprint separately for SR-07/SR-08
  and refreshed their current file hash. Original 18 records, original/review hashes,
  historical outcomes and deployed-reuse BLOCKED status are untouched. No detector
  exclusion or assertion was removed. Repeated full verification is authoritative.

## 2026-10-16: finish available runtime work and remove proven dead code
- Inspected actual cleanup hooks first: integration/security files DELETE users and
  FLUSHDB. Did NOT execute them against inherited/local/deployed targets. Docker,
  Flutter/Dart/Android SDK and devices absent. Restored scratch tools outside source.
- Obtained real PostgreSQL16 binaries from pinned npm package and built Redis7 from
  GitHub tag. First guessed PostgreSQL package version was absent; selected actual
  published 16.10.0-beta.15. Its skipped postinstall left library symlinks absent;
  inspected/ran only the scratch package symlink hydration. pgserver0.1.4 provides
  real psql16.2; server is PostgreSQL16.10. No production dependency/image changed.
- Added owned-cluster harness: private new PGDATA, random authenticated loopback ports,
  PID/data-directory verification, fresh random credentials, ignored inherited URLs,
  refusal of private dotenv config, and owned rejecting SMTP fixture (NOT provider
  delivery). Original psql bootstrap/fresh/repeat/populated/failure/grant probes run.
  Failure migration exists only in an owned temporary directory, never repo history.
- First real integration: 151 PASS / 3 FAIL (154); every failure traced to invalid
  ORDER BY/LIMIT accidentally applied to owner-scoped push-device DELETE. Removed
  that pagination only, preserved export SELECT limits, added regression. Repeated
  real integration: 154 PASS /21 files, security: 6 PASS /2 files. C32's final rerun,
  not earlier output, governs; all owned children/data stopped/removed afterward.
  No user database, deployment, existing volume or provider contacted or cleaned.
- Removed dead native Gemini/recording/cache/alarm-extraction/fake-sync scaffolding:
  the key reader unconditionally returned empty. Existing in-app OS speech channel,
  locale and legacy notification identifiers/receivers stay. Notifications open app,
  not a dead mic service or a fabricated automatic alarm. Kept AlarmReceiver/saved
  alarms and SMS/wallet/archive/Detox integrations. Removed unused mic capabilities/
  startup request. OS recognizer can use its own provider network; not offline proof.
  C33 eight source checks only; actual Android compile/lifecycle/device stays BLOCKED.
- C34 strict TS unused-local/parameter check PASS: no backend source candidates;
  no arbitrary exports/interfaces/casts/tests/report removal. No old device recordings,
  cache/user files or historical ledger values are automatically deleted.
- Added three invalid-reset operation-parity tests and a dummy comparison for wrong
  codes, matching missing/disabled branch. Current unit count 323/29; this does not
  equalize DB/Redis/SMTP wall-clock timing. Forgot-password timing remains unresolved,
  B-27 partial; no plaintext-secret queue, fake delay or error suppression added.
- C36 real local reachable Git UTF-8 history scan: 459 unique blobs /1 local commit,
  11 historical connection-string matches, 6 binary blobs explicitly skipped. FAIL
  retained, metadata only. No history rewrite, matching secret values in output,
  detector suppression, remote-history fetch or deployed-reuse/rotation certification.
  Original 18 source provenance records retained separately; not a fabricated 11:18
  mapping. Container scanning/hosted CI NOT RUN; real legacy rehearsal C35 BLOCKED.
- Registered refreshed C15-C17 scoped owned-runtime outcomes and C32-C36. Existing
  57 finding IDs/37 groups preserved. Source ZIP/report/manifest are regenerated
  after final safe/owned verification and independently byte-checked. No commit/push.


## Pre-device source completion after Windows/Android confirmation — 2026-10-16

- Inspected actual auth/controller/OTP/SMTP/shutdown/container/tests and Android/CI
  source before editing; API was already 202, not 200. Dependency restoration only
  was not recorded as new test success. No verified APK was claimed.
- Removed the direct forgot-password lookup/cooldown/SMTP response dependency with
  bounded volatile admission. Queue has no OTP/password fields; codes are generated
  after dequeue. Best-effort/non-durable 202 semantics and global 503 refusal are
  documented. Stop/drain precedes dependency closure, with a retained forced cap.
  Added 17 dispatcher/service/actual-HTTP regressions; targeted unit run reached
  340 tests/30 files PASS. Subsequent final C06 is authoritative after all edits.
- Inspection found the Git clone was shallow. Actual `git fetch --unshallow origin
  main` succeeded, HEAD/fetched main remain the baseline and working branch unchanged.
  Actual expanded detector run: 1,033 unique UTF-8 blobs/93 commits/37 URI matches/
  eight skips, FAIL. Earlier 459/one/11/six evidence remains above, not rewritten as
  full-history coverage. In-memory comparison confirms all 37 equal baseline public
  development-role defaults at loopback/Compose hosts; strict provenance negatives
  and the actual 37-record review PASS. Deployed reuse remains BLOCKED. No values,
  live connection, detector exclusion, Git rewrite, commit or push.
- Build review found executable Gradle statements before plugins, the absent Kotlin
  plugin despite built-in Kotlin being disabled, and a CI release-artifact expectation
  without signing provisioning. Corrected these source gaps, added explicit debug
  validation/default offline API and separately gated manual-main signed build,
  private existing-key preparation, expected-certificate verification, obfuscation/
  separate symbols and owned-file cleanup. Actual 12 preparation/filesystem/negative/
  parser/source/YAML/bash-syntax checks PASS; this is not Gradle or APK execution.
  Original 18 source-provenance records/hashes retained; SR-07/SR-08 append documented
  CI fingerprint follow-ups checked by C26, not blind hash replacement.
- Scratch Redis restoration initially invoked parallel recursive top-level make
  targets and exited 2. Re-ran once from the `src` directory (one make invocation):
  exit 0, server/CLI available and actual Redis7.4.6/PostgreSQL16.10 versions checked.
  Scratch-tool compilation is not application integration success; no app resource
  was adopted. Final full verifier freshly executes owned runtime again; its raw
  C01-C38 results govern, not previous PASS evidence or authored workflow contents.

- First fresh pre-device full verifier returned C04 FAIL (duplicate value/type import)
  and C32 FAIL: 153 integration PASS/one FAIL, security suite not reached. The new
  auth audit-correlation assertion found extractMeta read req.requestId even though
  middleware sets typed req.id; audit entries existed without the expected correlation.
  Fixed the actual controller field, kept the assertion, added HTTP audit-ID coverage
  and combined imports without weakening lint. First raw failures are preserved in
  evidence/iterations/predevice-first-C04.txt and predevice-first-C32.txt. Owned
  services were stopped/removed on failure; rerun creates entirely new fixtures.

- Corrected full verifier rerun: C02-C09 including lint PASS; 340 backend units/
  30 files PASS, owned integration 154/21 files and security 6/two files PASS;
  migration/grant/refusal/rollback probes PASS. All owned services/data were removed.
  C36 remains FAIL (37 reviewed historical matches), C38 provenance PASS and deployed
  reuse BLOCKED. C37 now includes 13 preparation/source/YAML/bash/copy checks PASS.
  No Flutter, Gradle Android, actual APK/signature, hosted workflow, device or real
  provider success inferred. Final C12 is rerun for all 39 changed Dart files after
  the six conditional-copy catalog edits/formatting; this is syntax-only, not Flutter.
