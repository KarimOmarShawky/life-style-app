# LifeStyle App remediation report — 2026-10-16



## Executive decision and delivery scope

The safe subset is delivered as source changes, not a production-ready release. All 57 source records were inspected and tracked, including low severity items and R-02/R-09/R-10. There are 37 administrative overlap groups, not 33+23 independent defects. Digital Detox is additional scope and is not counted as an independent audit finding.

Primary source: LifeStyle_App_Independent_Post_Remediation_Review_2026-10-13.pdf. The earlier audit is absent; original D-policy references are not invented. Source descriptions and severity are transcribed in findings.json; ambiguity remains explicit.

Base revision: 47cf1fd09540e7bcc8b291d6d9a1559cf0c5f855. Working branch: arena/3f871eac-life-style-app. No branch switch, reset, clean, commit, push, deployment or user database cleanup was performed.

This ZIP is an explicit patch set: changed/new repository-relative paths, no unchanged files or dependencies. Use apply-patch.md and deletions.json; do not treat it as a standalone repository.

File dispositions: {'M': 131, 'A': 125, 'D': 4}. Source record dispositions: {'fixed_verified': 11, 'partial': 24, 'code_unverified': 20, 'unclear': 2}. Conservative overlap-group dispositions: {'fixed_verified': 6, 'partial': 18, 'code_unverified': 12, 'unclear': 1}.

fixed_verified denotes only targeted executed regression evidence, not full feature or deployment assurance. code_unverified denotes changed/preserved code without relevant runtime proof; partial retains scope; open retains a correction gap; unclear retains product/provenance ambiguity. Only checks.json uses verification labels PASS, FAIL, BLOCKED, NOT RUN or NOT APPLICABLE.

## Actual verification and regressions

Final gate totals: {'PASS': 29, 'BLOCKED': 6, 'NOT RUN': 2, 'FAIL': 1}. 340 backend unit tests / 30 files PASS. Compilation, lint, format, build, production audit and OpenAPI gates: C02: PASS, C03: PASS, C04: PASS, C05: PASS, C07: PASS, C08: PASS, C09: PASS. WASM parsed 39 changed Dart files (PASS); that is syntax only, not Dart compilation, Flutter analysis, Flutter tests or Android/device evidence.

Current-source C25: PASS; 0 detector findings across 591 files at scan time. Detector probes and tooling audit execute; no exclusions were added. Original 18 findings and the earlier 16 retained patterns remain as historical provenance. The remaining tracked application-role defaults are now replaced coherently by per-installation local and per-job CI credentials, without detector exclusions. CI still has its public ephemeral administrator fixture; this is not proof that all possible secrets or live reuse are absent. Source provenance is not proof of absent deployed reuse; external credential assessment/rotation is BLOCKED. Local reachable Git text history executes separately in C36; historical matches remain FAIL. Container scanning and hosted CI remain NOT RUN. 

C10 clarified policy guard: PASS. The owner explicitly permits existing local Focus Timer audio, not server uploads. Only the reviewed mobile entries/consumer are permitted; no global picker allowlist or feature removal. C31 runs 21 negative/source/actual-CLI fixture checks; C06 includes 13 actual JSON-only middleware HTTP regressions. Neither certifies native picker traffic or absence of every possible leak. C11 PASS means the unsafe integration invocation was refused before suite execution; its expected exit code is 1. It is NOT a successful integration test.

Actual owned PostgreSQL/Redis integration/security and fixture migrations now execute under C32, with process/data-directory proof before destructive hooks. No user database, Docker build, full Flutter/Android app build, live SMTP delivery, signed release, whole-application E2E or physical-device enforcement was verified. The report distinguishes authored tests, source changes and actual executions. Earlier failed iterations and recovery are in verification-history.md; final raw logs are evidence/C01-C14 and C25-C38. C26 has 17 helper/source tests; C27 has 22 fresh-setup/source/command-spy tests, separate from backend units and not live infrastructure evidence. C28 has 16 hosted-resource command-spy/negative/source tests; the new hosted workflow itself is NOT RUN.

C29 runs eight synthetic-wire/source-contract Node checks, not Dart code. C30 compiles and runs ten real JVM checks against the actual Android-free AES-GCM staging implementation, not the Activity/MethodChannel bridge or document providers. Twenty-five new Flutter cases are authored, NOT RUN; full Flutter/Android/provider/lifecycle/device verification remains BLOCKED. Scratch Java/Kotlin availability does not remove C19-C22 blockers.

## Owner clarification: local audio is permitted, server uploads remain forbidden

# Owner clarification: local focus audio is not a server upload

## Decision and scope (2026-10-15)

After the agent explained that file_picker is used to choose a local Focus Timer
sound, the owner explicitly clarified that the prohibition concerns uploading files
to the server, to avoid leaks. This records that clarification now; it does not
invent approval at an earlier audit date or authorize a general file-upload feature.

The existing user-selected audio/local playback feature remains allowed. No server
file/image upload endpoint, multipart parser, blob storage SDK, background file sync,
new picker consumer or additional permission is authorized. This is a clarification
of D-08 / ADR-039's server-upload boundary, not ADR-008: the actual repository's
ADR-008 describes UUID primary keys, despite the old guard's misleading category.

## Enforcement changes

- The guard still scans the real Flutter manifest/lock and backend/root config.
- There is no global file_picker allowlist entry. Only its existing direct dependency
  line (`^13.1.0`) in the mobile manifest and its own hosted/direct 13.1.0 lock block
  are permitted. A version/declaration change requires explicit guard review.
- Only the existing Focus Timer Dart consumer and its single audio-only picker call
  are accepted. Additional picker imports/exports, aliases, federated-package imports
  or broad/multiple calls fail the guard. This is a conservative source-pattern check,
  not Dart semantic/dataflow analysis or a general exfiltration detector.
- Backend/root file_picker declarations remain forbidden. Production backend multer,
  busboy, formidable and S3 SDK dependencies still fail, including when someone tries
  to globally allowlist them. The existing formidable development/test-tool exception
  is unchanged; it does not permit production usage.
- The CLI is fixed to its repository; inspection functions are exported for synthetic
  tests, not an environment/CLI root-selection bypass. Invalid policy parsing or
  incomplete source inspection fails closed. Diagnostic output contains paths/line
  numbers/categories, not configuration values or file contents.

## Actual reviewed flow and evidence limits

The current Dart selection method asks for FileType.audio, stores its path/display
name in local preferences, and passes the path to audioplayers' device-file source.
No HTTP/API/byte-read/upload call was identified in this selection/preference/playback
flow. No mobile feature, dependency version, permission, API route or production
middleware behavior was changed for this clarification. This does not certify the
plugin/player's native internals, OS permissions, backup behavior or actual device
network traffic; Flutter/build/device verification is still BLOCKED.

An OS chooser may offer cloud-backed providers. User-directed provider retrieval and
OS/provider backups are not proof of an application-server upload, and local path/name
preferences are not certified secret-free or excluded from every OS backup. No broad
"the whole app cannot leak" statement follows from this decision.

## Executed checks

C10 executes the real dependency/source guard. C31 executes 21 Node checks: synthetic
positive/negative config/source cases and actual CLI copies in owned temporary source
fixtures, including forbidden backend dependencies/new consumers and malformed policy.
It also checks the current Dart local-audio flow and middleware order as source
contracts only. Temporary fixtures do not touch application/user data or services.

C06 includes 13 additional actual Express middleware HTTP checks: POST/PUT/PATCH
reject multipart, audio and octet-stream bodies with 415 before an endpoint handler,
ordinary JSON still works, and oversized JSON rejects with 413. They execute the real
existing JSON-only middleware/error handler without a database, Redis, saved upload
or production service. They are not a full production-router/device E2E test.

Structured JSON (notes, tasks, etc.) is intentionally accepted by this application;
JSON can encode arbitrary text. MIME/dependency guards are not DLP and do not prove
that every possible encoded payload, third-party integration, malicious change or
compromised dependency cannot exfiltrate data. Required release work includes native
picker/playback tests and device network observation: selected audio bytes/path/name
must not be added to API, analytics, logs or other third-party payloads. Any future
server-upload proposal requires a separate explicit privacy/security decision.

Historical C10 FAIL evidence remains described in verification-history.md. Current
checks.json/evidence/C10.txt and C31.txt govern the new result; passing the clarified
policy guard does not convert any Flutter/Android/live-infrastructure gate to PASS.


## Actual owned runtime verification, cleanup, residual timing and Git-history findings

# Real disposable runtime verification and evidence-led cleanup — 2026-10-16

## What actually executed

Docker, Flutter/Dart and Android SDK were not available. Rather than substitute an
in-memory database or claim mock integration, scratch tools were installed OUTSIDE
application source: embedded PostgreSQL 16.10, psql 16.2 client from pgserver 0.1.4,
and Redis 7.4.6 built from its tagged GitHub source with libc allocator/no TLS.
These are sandbox verification tools, not production image/dependency changes or
certification of their security patch level. No Docker/image/build parity is claimed.

`python scripts/run-disposable-verification.py` creates a new private temporary
PostgreSQL cluster and authenticated Redis process on random loopback ports. It never
accepts an existing DATABASE_URL/REDIS_URL, strips inherited provider settings, refuses
private dotenv files and generates new credentials. It checks the live PostgreSQL
data directory/listen address/postmaster PID and Redis server PID against its owned
processes BEFORE any migration or destructive suite hook. Tests' DELETE FROM users
and FLUSHDB hooks were inspected first; only the new unique lifestyle_test_* database
and Redis database 15 of that owned instance are targets. A private rejecting SMTP
fixture exercises failure behavior only; no real provider mail delivery is certified.

Actual psql executes the repository fresh-role bootstrap, then verifies repeat
bootstrap refusal. Actual node-pg-migrate executes fresh, repeated and synthetic-
populated forward migrations as lifestyle_migrator. The harness checks stable history,
preserved fixture rows, non-superuser runtime identity and refused runtime DDL. An
intentional failing migration in an OWNED temporary copy must roll back its partial
table/history and preserve earlier fixture data. No repository migration is rewritten
or rolled down to make the test pass. This is current-schema fixture coverage, not
an upgrade/restore rehearsal of an unknown deployed legacy schema (C35 BLOCKED).

C15/C16 record the actual integration/security commands inside C32. The first real
integration run had 151 PASS / 3 FAIL (154 cases): deletion scheduling returned 500.
The cause was export pagination accidentally applied to a push-device DELETE, which
PostgreSQL does not support and must not truncate. Removed ORDER BY/LIMIT only from
that owner-scoped DELETE, retained bounded export SELECTs and added a unit regression.
Rerun: all 154 integration tests / 21 files and six security tests / two files PASS.
The live archive projection/snapshot/grants/tenancy and deletion-grace HTTP tests
are now actually executed; prior statements that they were merely authored are history.
The final C32 raw log and disposable-results.json govern subsequent reruns.

Every command has asserted outcomes, including expected nonzero refusals. Secrets
are redacted from captured diagnostics; only the harness's child processes and owned
fixture directory are stopped/removed. No app service, user database, Docker volume,
existing PostgreSQL/Redis data, deployment, commit or push is touched. The remaining
Docker, Flutter/build/signing/provider/device/E2E gates are NOT inferred PASS.

## Cleanup performed, and what was deliberately preserved

Inspection proved the native Gemini key reader unconditionally returned empty. Both
native provider-upload branches and dependent JSON/base64/HTTP, alarm extraction,
nonfunctional backend-sync logging, recording timers/cache scaffolding and unused
imports/helpers were therefore removed. The app no longer records a temporary voice
clip just to enter an always-unconfigured provider branch. No replacement provider,
embedded key, fake transcription or silent success was added.

In-app speech retains the same method channel and locale, now using the already-
existing OS recognition activity directly, with busy/cancel/disposal guards. The OS
recognizer may use its own provider's network service; this is NOT guaranteed offline
speech or proof of no third-party transmission. Android compilation and actual speech
availability, activity lifecycle and notification behavior remain BLOCKED.

Old quick-input notification actions now open the existing app, not a dead microphone
service, and copy no longer promises automatic voice alarms. Stable notification IDs,
receiver/private-service compatibility entry points, existing alarm receiver, SMS/
wallet/archive/Detox channels and saved user alarms/data are preserved. The private
legacy service does not record or schedule an alarm. Removed automatic startup mic
prompt and now-unused RECORD_AUDIO/FOREGROUND_SERVICE_MICROPHONE capabilities; the
OS recognizer activity owns its own capture/permissions. Device behavior still needs
verification, not a source-test assertion. No old user cache/recording is auto-deleted.

C33: eight source-contract checks only (not Android execution). C34: actual TypeScript
`--noUnusedLocals --noUnusedParameters` PASS; it found no backend-source candidates,
so none were invented/deleted. Useful migrations, tests, evidence, reports, exports,
local audio and user data were not removed to reduce file count. This is targeted
cleanup, not a claim that every unused symbol/duplicate in every platform is proven gone.

## Reset timing: admission decoupled; delivery/load/shutdown runtime limits remain

The earlier refresh added one dummy bcrypt comparison for existing-user invalid reset
codes, matching unknown/disabled branches. That operation-parity coverage is retained;
DB/Redis timing is not cryptographically constant-time.

The new forgot-password path admits work before **any account lookup, cooldown check,
OTP creation or SMTP operation**. It returns the existing generic `202 {}` for registered,
unknown, disabled and cooldown cases; a globally full/stopping service returns the same
503 admission refusal independently of the submitted account. The existing IP limiter,
Redis atomic cooldown, HMAC-only OTP store, 15-minute OTP TTL and five-attempt limit
are not relaxed. OpenAPI no longer falsely claims 200, sent email or equalized timing. All six mobile
catalog messages now use conditional best-effort wording, not a sent-email assertion.

One dispatcher belongs to the production singleton AuthService per API process:
64 total waiting+active requests, four concurrent workers, maximum 60-second queue wait.
Only copied email and capped request metadata are queued in memory. Extra caller fields
are projected away; OTPs are generated **after dequeue**, remain worker-local until
SMTP returns and never enter a persistent email queue or diagnostic output. Historical
email-queue deletion stays. AsyncLocalStorage is detached so one HTTP request's user
context is not retained/inherited by other background requests. Expired work and
processing errors produce fixed sanitized diagnostics; SMTP rejection still records
failure, not success, in the audit. SMTP acceptance is not proof of inbox delivery.

This is explicitly **volatile best-effort acceptance**, not durable delivery. Crash,
restart, queue expiry or forced shutdown may lose an accepted request. A user can retry
subject to existing rate limits/cooldown; no fake delivery success or dummy delay is
introduced. Shutdown stops admission immediately and waits for the dispatcher before
closing Redis/PG. The existing 30-second forced-exit cap remains; timeout logs only
counts and explicitly warns that accepted volatile work may be lost. Actual process-
signal/SMTP shutdown choreography and production aggregate load remain unverified.

Seventeen new dispatcher/service/HTTP regressions cover admission before work, stalled
lookup/cooldown/SMTP without holding 202 open, generic inactive cases, queue/concurrency
bounds, expiry, sanitized errors, drain/stop behavior, metadata projection and context
isolation. They are part of final C06, not live-provider or statistical timing proof.
The actual auth integration case now drains admitted work before reading Redis and
asserts HMAC-only storage/audit correlation before proceeding; cleanup drains before
DELETE/FLUSHDB. Tests are never pointed at existing user services. B-27 stays partial
pending production-representative load/timing/provider/shutdown evidence; the earlier
specific synchronous-SMTP request-path gap is no longer left unimplemented.

## Expanded Git-history review, without clearing the detector

The previous 459-blob/one-commit/11-match FAIL is retained in verification-history.md.
Inspection found a shallow checkout. An actual `git fetch --unshallow origin main`
retrieved ancestry without switching branches, changing HEAD, rewriting commits or
pushing. HEAD and fetched main both remain the review baseline; the checkout is no
longer shallow. No historical source is checked out/executed or written to disk by
the detector. Its batches use the pinned detectors with no suppression change.

C36 now covers **1,033 unique UTF-8 blobs across 93 reachable commits**, with **37
connection-string matches in 18 distinct blobs** and eight binary/non-UTF8 exclusions.
Unique-blob matches are not the same inventory as the original 18 source-location
provenance records; duplicated paths/versions are not invented as new independent
credentials or mapped one-to-one to those records. These 37 matches have metadata
only in history-scan.json. Unreachable/unfetched refs, binaries/images and private
runtime configurations are not certified.

C38 independently compares every matched historical URI IN MEMORY with the exact
three development-role defaults in the baseline init-roles.sql, checks approved
historical configuration/test/helper paths and local hosts, and rejects query/fragment
overrides, unknown rules/paths/credentials or remote hosts. **All 37 match those baseline
repository defaults**: 31 declared loopback and six Compose-service URLs. The strict
negative self-test checks that filename alone cannot authorize a classification.
history-provenance.json retains every blob/path/line/rule, comparison decision,
reference commit/path and separate BLOCKED deployed-reuse verdict, without values.
This provenance review can PASS while **C36 remains FAIL**: exposed historical defaults
still exist in Git and could have been copied elsewhere. No history rewrite, allowlist,
rotation or live connection is performed. Original 18 records/hashes remain intact;
SR-07/SR-08 append a documented follow-up fingerprint chain for the authorized CI edit,
rather than overwriting their earlier fingerprints. Deployment inventory/coordinated
rotation remains an owner task if these defaults were reused.


## Mobile build preparation and truthful artifact/signing boundaries

# Android build preparation before Windows/Android device testing — 2026-10-16

## Actual state, not a build claim

C37 executes 13 private-filesystem, negative-input, certificate-output parsing, source-contract/YAML/bash-syntax and actual missing-SDK CLI-refusal checks. Its synthetic bytes are NOT a real keystore/APK, and its synthetic certificate output is NOT an apksigner execution. No Flutter/Android SDK is available in this sandbox. Flutter analysis/tests, Gradle Android compilation, real APK signature verification, hosted CI and device installation remain C19–C24 BLOCKED/NOT RUN as individually recorded. There is no verified APK from this work yet.

The user has Windows and an ordinary Android phone. They do not need to install anything to complete this source preparation. Do not request signing passwords, key files or provider keys in chat. No workflow was pushed, dispatched or deployed.

## Demonstrable source/configuration gaps corrected

- Gradle Kotlin DSL `plugins` now precedes executable property-loading statements; property streams close with `use`.
- The existing project explicitly has `android.builtInKotlin=false` and `android.newDsl=false`. The configured `org.jetbrains.kotlin.android` plugin is now actually applied, before Flutter; this does not silently flip the project's AGP 9 compatibility strategy.
- Java 17 is explicitly selected in mobile CI, matching the project's JVM target.
- `preReleaseBuild` depends on a signing precondition requiring all four private properties and a readable keystore. Release explicitly selects the release signing config. There is no debug identity fallback or intentional unsigned-release path. Actual AGP task execution still requires Android SDK verification.
- Default CI builds/debug-signs a **debug validation APK**, verifies that signature with the SDK apksigner, and only then uploads an artifact named `lifestyle-android-debug-validation-NOT-RELEASE`. Missing artifacts fail the job. This is not presented as a release.
- Debug CI overrides the app's existing deployed-server default with `https://validation.invalid/api/v1`, intentionally offline. It cannot accidentally point a tester at production by inheriting that default. Manual workflow dispatch can explicitly choose `validation_api_base_url` for an approved HTTPS disposable test backend; URL shape/credentials/query/fragment are validated without making a request. A default offline APK does not support backend-dependent feature verification. No existing server is contacted by this preparation.

## Explicit, fail-closed signed-build path (authored; hosted execution NOT RUN)

`CI Pipeline` has a manual `build_signed_release` boolean, off by default. The signed job is eligible only for manual dispatch on `main`, after both backend and debug-mobile quality jobs succeed. It builds artifacts only, never publishes/deploys. Environment `android-release` is a configuration boundary, **not inherently a protected environment**: the repository owner must configure its allowed branches, approvals and secret access before use.

Configure through repository/environment settings, not conversation:

- Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, from an existing approved release key. The helper never generates a release identity.
- Variables: `ANDROID_RELEASE_API_BASE_URL` (explicit HTTPS API ending in `/api/v1`, not the offline `.invalid` endpoint) and `ANDROID_RELEASE_CERT_SHA256` (expected public signing-certificate SHA-256, 64 hex characters; colon separators accepted).

The helper validates presence/base64/bounds, refuses existing `android/key.properties`, uses exclusive private files (directory 0700; properties/keystore 0600 on the Linux runner), escapes Java Properties including Unicode/newlines/backslashes, and puts the keystore in a unique runner temporary directory. It prints no signing values. Gradle cache export is disabled in this signing job. Only the APK and separate obfuscation symbols are uploaded, never the keystore, properties or entire workspace. Cleanup targets only the files created by that job, even on failure; it does not delete a user's existing signing configuration. Ignored `*.jks`, `*.keystore`, `key.properties` and `*.hprof` must not enter source packaging; the patch packager also rejects forced private-file inventory entries.

Release build uses `--obfuscate --split-debug-info` outside source, with matching symbols preserved separately. Obfuscation is not encryption, credential protection, or proof that a binary contains no sensitive material. Keep symbols paired with the matching APK for debugging and subject to repository access control. These temporary CI artifacts use a seven-day lifetime, not an application-user-data deletion policy.

Before upload, `verify-android-apk.mjs` invokes the actual Android SDK `lib/apksigner.jar` through Java without a shell (also avoiding Windows `.bat` quoting problems). The command must succeed, report exactly one signer and provide its SHA-256 digest; release rejects the debug identity and any missing/unexpected public certificate. Debug verification requires the explicit Android debug identity. Certificate-parser regressions do not substitute for executing this against a built APK.

## Honest reset-request copy

All six locale catalog messages now say conditionally that the app will **try** to send a code if the address is eligible; none asserts that HTTP 202 proves email delivery. The existing UI key is retained for compatibility. C37 checks these source entries, and C12 parses modified Dart; Flutter rendering/behavior still requires actual Flutter/device execution.

## Next verification boundary

Run the authored pipeline on reviewed source, resolve actual Flutter/Gradle failures without relaxing gates, and inspect a successfully built/signature-verified APK. For connected device tests, select an explicitly approved disposable HTTPS backend, never the offline default or unapproved production service. Only then perform the Windows/Android install, permissions, speech lifecycle, archive/save-provider, wallet, alarms and both Digital Detox modes checklist. Ordinary consumer Android restrictions do not lock the whole phone or guarantee enforcement; no accessibility/device-admin capability is added here. Backend/SMTP connectivity, live provider delivery, Android lifecycle/upgrade/signature continuity and device enforcement are not certified by source preparation.


## Database deployment and data preservation

# Versioned database deployment and recovery

Authoritative DDL: `backend/src/infrastructure/database/postgres/migrations/*.cjs`.
Run as `lifestyle_migrator`, never the runtime role. Health probes and API startup
never create schema. The runtime image includes CommonJS migration files and the
production migration CLI. Production secrets must be supplied by a secret manager;
no production role passwords are supplied by the fresh-local generator.

## Fresh local install
Follow [private fresh-local setup](../development/local-setup.md):
`node scripts/local-setup.mjs --fresh-install`, then
`node scripts/local-stack.mjs --check`, and only after explicit review `--start`.
Do not copy `.env.example` expecting usable passwords; no services are started by
credential generation. The wrapper pins a random independent project namespace,
private env file, root Compose file and local Unix Docker socket.

Fresh PGDATA bootstrap requires environment-supplied credentials/acknowledgement,
refuses existing roles/public objects/non-default user schemas, and creates roles
transactionally. The one-shot migration service gates API/worker startup. Actual SQL/bootstrap/forward/failure/grant probes now execute in a fresh owned
cluster (C17/C32). Docker/Compose and actual legacy deployment/restore rehearsal
remain BLOCKED (C18/C35). Failed PG initialization may leave PGDATA
initialized without retrying its SQL hook: inspect privately, never delete volumes
or repeat startup as an automatic repair. The compatibility Compose file has the
same required parameters and adjusted paths; never invoke it unscoped.

## Existing versioned installation / repeated deploy
1. Take and verify a database backup; test restoration on an isolated copy.
2. Verify the image revision, database identity and migration owner out of band.
3. Stop writes if required by a particular migration's locking/compatibility needs.
4. Run `DATABASE_MIGRATION_URL=<secret> npm --prefix backend run migrate:up`
   from source, or run `npm run migrate:up` inside the image with that environment.
5. Inspect exit status and `pgmigrations`; do not start the new application if it failed.
6. Repeat `migrate:up` safely: node-pg-migrate's history and lock skip applied files.
7. Confirm grants with `has_table_privilege('lifestyle_app','ingest_tokens','DELETE')`.

The forward migration `1792022400000_ingest_delete_grant.cjs` repairs the missing
DELETE permission on existing databases. The previously edited ingest migration
is restored to SELECT/INSERT/UPDATE. No ledger rows or personal data are rewritten.
The grant repair is forward-only: its down handler refuses rather than revoke
possibly pre-existing privileges. CI therefore uses fresh up / repeat up, not a
blind production down. Backward rollback of data migrations is not a recovery plan.

## Legacy installations without migration history
Do **not** blindly run initial CREATE TABLE migrations or forge history. Restore a
copy of the database, compare actual columns, constraints, indexes and grants with
the versioned migrations, then approve and record a matching baseline before adopting
the runner. The historical manual upgrade SQL covers only ingest tokens and optional
timer task, not a complete baseline. A general legacy adoption script remains BLOCKED
pending the actual deployed schema/history; table-name parity is insufficient evidence.

## Failure and recovery
Migration errors propagate and gate deployment. Keep the runner's default migration
lock and transactional behavior. Investigate failures on a restored copy; repair via
a reviewed forward migration, not by editing applied files or deleting user records.
Re-run after fixing the cause. Never disable locks or use force to bypass a failure.
Test fresh, repeat, populated upgrade, interrupted deployment and least-privilege
scenarios in isolated PostgreSQL before production. These scenarios have NOT RUN
in the sandbox (no PostgreSQL/Docker), so compatibility is not certified here.

## Historical defaults and existing credential changes
All 18 historical URI matches are preserved in `docs/remediation/secret-triage.json`.
Their tracked application defaults are now removed without scanner exceptions;
production URI validation still rejects the old public values, including encoded
or query-password forms. A zero-finding current-source scan does not prove absence
of deployed reuse. The public ephemeral CI administrator fixture remains.

The fresh generator/bootstrap is NOT an existing-install upgrade/rotation tool.
Changing environment settings does not change passwords stored in an old PGDATA;
initialization hooks do not rerun for an existing volume. Never attach legacy
volumes to a new namespace or replace working secrets with newly generated ones.
Use the backed-up, coordinated operator plan in `../development/local-setup.md`
for any approved role/client/JWT/OTP change. No live rotation has been performed.

`ensure-env.sh` is configuration-only and never applies migrations. Both Compose
sources retain loopback infrastructure host bindings; runtime networking remains
unverified. Keep existing volumes and data through reviewed forward deployment.


## Fresh-local generation and existing-install credential safeguards

# Private credentials for a fresh local installation

## Scope and verification

This is an opt-in **fresh local installation**, not an upgrade, production secret
manager or password-rotation tool. Node 22+ and POSIX private-file permissions are
required; the helper refuses Windows rather than claim equivalent ACL protection.
Docker Compose v2 and PostgreSQL/psql 16+ are required for the proposed stack.
Source/helper tests PASS; actual Compose/SQL/migration/service execution is BLOCKED
in this sandbox because Docker/PostgreSQL are absent. Hosted CI has NOT RUN.

## Before generating anything

Confirm this checkout is for a genuinely new installation, with no existing data
or infrastructure to adopt. Merely lacking an .env file does not prove that.
Back up existing installations instead and use the upgrade section below. The helper
refuses root/backend `.env` and `.env.*` files except `.env.example`, symlinked or
noncanonical paths, and any pre-existing `.local-setup` file/directory/symlink.
There is no force, overwrite, cleanup, import or regeneration switch.

From repository root, only after confirming the fresh-install scope:

```bash
node scripts/local-setup.mjs --fresh-install
# Configuration only: no Docker command, migration or password rotation.
node scripts/local-stack.mjs --check
# Only if local validation succeeds and you explicitly want to create the new stack:
node scripts/local-stack.mjs --start
```

The first command generates six independent 32-byte cryptographic random values:
PostgreSQL administrator, runtime, migration and maintenance passwords plus JWT and
OTP keys. It writes only the ignored `.local-setup/` directory (0700), with exclusive
0600 `compose.env`, `host.env` and `setup.json` files. Credentials are not printed.
If a write fails, the new incomplete private directory is left for manual review;
no directory or previous configuration is deleted or overwritten. Reruns refuse.

The loader verifies owner/private modes, regular nonsymlink files, expected schema,
unique 64-hex credentials, local targets and matching role/URI/signing settings.
`compose.env` supplies the container network configuration; `host.env` supplies
matching localhost settings for a trusted host-side environment loader. Do not
paste, cat, upload or commit either file. Copying `.env.example` alone intentionally
does not provide passwords or usable JWT/OTP keys. Never disable authentication to
make the template work. Do not use the generated development database for tests.

## Namespace and startup safeguards

Each generated configuration has an independent random Compose project namespace.
Both Compose sources require its generated values and have no global container names.
The wrapper pins the root Compose file, explicit private env file, project and local
Unix Docker socket; it strips ambient `COMPOSE_*`/`LOCAL_*` overrides and rejects
nonlocal Docker endpoints/contexts. It captures and suppresses raw Docker output
because resolved settings/diagnostics can contain secrets. A port collision must
be investigated, not "fixed" by stopping/deleting an old stack or its volumes.

The default `--check` requests quiet configuration validation only. `--start`
requests detached build/start, not health, migration or application certification.
There is no down/delete operation. Do not use unscoped legacy Compose commands for
logs/stop/restart: an operator must explicitly use the reviewed generated project,
root file, private env file and same local Docker endpoint. Never publish raw
`docker compose config`, container inspect, database connection or startup logs.

PostgreSQL's fresh-PGDATA hook uses required process environment variables, a fresh
acknowledgement and one transaction; it refuses existing application roles, public
objects or additional non-system schemas. It creates three least-privilege roles;
there is no existing-role alteration. A missing variable fails before secret SQL
interpolation. The one-shot forward migration service must succeed before API and
worker startup. These are source safeguards, not proof of resource ownership or
successful runtime behavior. Public database/Redis/mail host ports remain loopback
bound; the existing API publishing policy is unchanged.

On first-init failure, PostgreSQL can leave an initialized PGDATA for which entrypoint
SQL will not run again automatically. Stop and inspect the exact new installation
privately; do not repeatedly start the application expecting bootstrap to retry.
Do not delete volumes or remove the private directory as an automatic repair. A
reviewed repair/reinitialization plan needs confirmed ownership, backup/restore
checks and explicit approval. Preserve failure evidence without secret values.

## Existing installations and credential rotation

**Do not run the fresh generator/bootstrap to upgrade or rotate an existing stack.**
Changing a Compose environment variable does not change a password in an existing
PostgreSQL data volume. Its initialization SQL runs only for fresh PGDATA, and now
refuses existing roles when explicitly invoked. Do not attach an old volume to a
new generated namespace or copy new passwords over old settings.

1. Identify the actual project, endpoints, roles, migration history and all clients
   (API, worker, migrator, maintenance). Preserve current working configuration.
2. Take and verify database/configuration backups and rehearse restoration and the
   proposed forward migration/credential plan on an isolated copy.
3. If rotation is needed, have an authorized operator provision secrets and review
   an explicit coordinated database-role/client update, outage/connection-drain
   strategy, rollback and verification plan. No generic ALTER ROLE command or
   automatic rotation is supplied by this helper.
4. Changing JWT/OTP keys also affects sessions and pending reset verification;
   review these effects and supported previous-key handling before any change.
5. Check each role's connection/grants, migration state, health and application
   flows before approval. Keep old data/volumes; see `../database/migrations.md`.

These operator actions have NOT RUN here; deployed credential reuse/rotation is
BLOCKED, irrespective of the clean current-source URI detector result.

## Storage and CI limitations

These are plaintext local files protected by filesystem permissions, not encrypted
or managed production secrets. Same-user/privileged operators, Docker inspection,
backups and compromised processes can expose values; the helper is not a defense
against those actors. The source packager refuses private env/setup paths even if
force-added to Git. Source scanning does not inspect these ignored private files.

CI's separate `ci-database-env.mjs` generates per-job application-role/JWT/OTP
credentials, registers GitHub masking directives before appending to the existing
runner environment file, and never executes database commands. Do not run it as a
local setup command: masking directives contain values for the trusted runner to
consume. The `GITHUB_ACTIONS` flag is a context check, not an authentication boundary.
The public ephemeral CI administrator fixture remains; not all CI fixtures have been
eliminated. Local runner-file tests are not hosted-runner, isolation or masking proof.


## Sensitive actions and deployment compatibility

# B-18 reauthentication contract

`POST /api/v1/users/me/export`, `POST /api/v1/users/me/export/archive` and
`POST /api/v1/users/me/deletion` require
JSON `{ "currentPassword": "..." }`. The proof is checked against the authenticated
user's password hash, never against a body-selected user. Missing/extra fields fail
400, incorrect proof fails 403 REAUTHENTICATION_FAILED, and a shared five-attempt /
15-minute per-user budget bounds expensive verification across metadata export, archive and deletion.
Redis unavailability fails these sensitive actions closed with 503 before proof or data
access; the unrelated general fail-open availability policy is preserved. User
responses include Cache-Control: no-store. Authentication and pending-deletion
route restrictions remain enforced.

The mobile profile asks for the current password before either action, passes it
through existing repository/provider flows, and keeps controller ownership in the dialog state through route disposal.
New text uses the English localization catalog with the existing fallback mechanism;
additional translations are not claimed.
It is never persisted or included in export responses/logs. Coordinated client/server
deployment is required: old clients without the proof now fail closed (400).

Real-router unit tests exercise missing/wrong/right proof, unauthorized requests,
identity injection rejection, rate-limit boundaries and Redis-outage rejection. Integration callers are updated
the owned real-database integration suite now executes in C15/C32; mobile UI tests remain BLOCKED. Two dialog widget tests
cover empty/whitespace/cancel/reopen and exit disposal; these are authored, NOT RUN.
The mobile export now previews without automatically copying. Explicit risk
acknowledgement and a Copy action are required; success follows platform confirmation
and failures do not expose provider error strings. Four clipboard widget tests are
authored, NOT RUN. See follow-up-hardening.md for production logger/rate-limit scope.
The current mobile metadata response remains materialized, with server list limits;
native archive provider/device verification and explicit clipboard-copy/history risks remain residuals. This is a partial B-18
remediation, not complete erasure or export assurance.

## Actual export coverage (continued review)
The legacy DTO contains profile, sessions, categories and push-device metadata only.
It is not a full GDPR/data-portability archive. Tasks, notes, habits, events, ledger
records and other domains are absent. API/UI wording now discloses this limitation.
The profile export query does not fetch authentication hashes, and a concurrently
missing account returns controlled 404. Legacy lists now reject overflow above
1000 rows with 413, never silent truncation. An additive backend streamed domain
archive now covers 21 explicit sections with limits/completion validation; real
PostgreSQL projection/snapshot/tenancy fixtures now execute in C15/C32; native saving remains runtime-unverified. Android source now adds
strict streaming verification, encrypted staging and a separate explicit save action;
see `../mobile/account-archive.md` for scoped executed JVM checks and remaining gates. See
`../api/account-archive.md` for its contract and remaining work, and
session-and-scanner-hardening.md for the historical SQL-harness/transaction scope.


## Additional user-requested hardening after first delivery

# Follow-up hardening — 2026-10-15

The user requested additional safe actionable work after the first delivery.
These changes extend the existing B-18/B-16 scope; they are not new independent
audit IDs and do not change the 57-record / 37-overlap-group reconciliation.

## 1. Sensitive-action outage protection and cache privacy

Root cause: the existing Redis limiter deliberately failed open for general
availability, so its newly added sensitive-action caller inherited unlimited
password attempts during a Redis outage. Preserve the original general policy;
report an explicit `unavailable` result and opt only export/deletion into fail-closed
behavior. They return 503 SERVICE_UNAVAILABLE before password verification or data
mutation. Normal quota exhaustion remains 429. No policy threshold was changed.
All user-router responses now include Cache-Control: no-store, including errors.

Increment, TTL lookup and initial/repair expiry now use one Lua operation instead
of a pipeline followed by a separate EXPIRE round trip. This prevents interleaved
first-hit expiry resets and the ordinary two-round-trip failure gap. The in-memory
limiter now resets at the exact expiry boundary (>=, not >). Lua errors are reported
as unavailable; Redis scripts are not rollback transactions, so a partial write on
an ACL/runtime error is not claimed impossible. Redis credentials/errors are not
included in outage logs. Redis ACLs must permit the script's commands.

Verification: real-router HTTP units for both actions assert 503/no proof/no export
or deletion during a fake Redis outage, plus no-store on success/error. Nine rate
limiter unit tests cover quota, expiry, key separation, Lua call/result contract,
malformed results, secret-free outage logging, fail-closed and preserved general
fail-open behavior. PASS in the 213-test / 24-file backend run. The Redis dependency
is a fake: actual Lua execution/concurrency/failover remains BLOCKED without an
isolated Redis instance. No live data service was contacted.

## 2. Actual production logging configuration

Root cause: the old logger test created a separate Pino instance with its own
redaction settings, rather than verifying the production configuration. Existing
paths also stopped short of req.headers / nested token response fields.

`createLogger(destination)` is now the same factory used by production and by
capture-stream tests. Known credential fields are redacted at top level and one
or two nested object levels, including password proof, token responses and headers.
The complete req/request/res/response body containers are suppressed, so arbitrary
depth HTTP financial/private payloads are not logged through those containers.
Tests verify actual output, async request-context separation and no input mutation.
Four logger units PASS in the backend run.

Scope limit: this is NOT arbitrary recursive secret discovery, free-text message
scrubbing or a certification that every historical/third-party log is safe. Never
put credentials in log messages, provider error strings or custom unbounded objects.
Legacy queue/log/snapshot retention remains governed by the deployment runbook.

## 3. Explicit export clipboard consent

Root cause: opening an account export automatically put all personal/financial JSON
onto the system clipboard. The mobile profile no longer performs that write.
A dedicated dialog shows a bounded preview and truthful clipboard-history/sync
warning. Copy is disabled until acknowledgement, and still requires an explicit
Copy action. Success appears only after the platform method completes. A platform
failure shows a generic error (no provider exception) and permits retry.

No automatic clipboard clearing or history revocation is claimed. The legacy
metadata action does not save an archive file. Clearing later could overwrite unrelated clipboard contents and would
not erase clipboard history/synced copies anyway. The export is still materialized
in memory for the legacy metadata client; that server route now has explicit list
limits. A separate streamed domain archive and Android validation/encrypted-staging/
explicit-save source now exist. Flutter/bridge/provider/live SQL/device verification
remains open under B-18; executed JVM-stage checks are narrower, not device proof.
See ../api/account-archive.md and ../mobile/account-archive.md.
English catalog entries use the existing localization fallback; new translations
are not claimed.

Four widget tests were authored: no implicit writes on open/close, acknowledgement
without copying, exact explicit-copy data, revoked acknowledgement, and platform
failure/retry. These are NOT RUN (Flutter SDK unavailable). All changed Dart files
have syntax-only WASM parsing; that is not Flutter compilation, widget/device or
clipboard integration evidence.

## Commands actually executed

- `cd backend && ./node_modules/.bin/vitest run tests/unit/rate-limiter.test.ts tests/unit/logger-redaction.test.ts tests/unit/sensitive-actions.test.ts`: PASS, 19 targeted tests / 3 files.
- `npm --prefix backend run typecheck:tests`: PASS.
- `npm --prefix backend run test:unit`: PASS, 213 tests / 24 files.
- `npm --prefix backend run openapi:generate`: PASS; 400/403/429/503 contracts updated.
- `node scripts/check-dart-syntax.mjs /home/user/tooling/node_modules/@wasm-fmt/dart_fmt/dart_fmt_node.js`: PASS, 26 changed Dart files; syntax only.
- Final full safe gate outcomes and raw evidence are regenerated in checks.json;
  previous delivery's 202-unit / 24-Dart counts are historical, not current.

No new destructive cleanup, migrations, deployment, credentials, permissions,
platform enforcement capability or product-policy thresholds were introduced.


## Continued work: authentication transactions, source scanning and truthful export scope

> Historical transaction/scanner batch below. Current follow-up results are in checks.json, secret-triage.md and ../api/account-archive.md; the earlier 18/16 scan failures are retained as history, not current totals.

> Prior-stage execution evidence: the 18-match scan and 254-test total below were
> accurate at that stage. See `secret-triage.md`, C25/C26 and current checks.json
> for the later 18-to-16 review and production/helper safeguards.

# Session lifecycle, source scanning and truthful export scope — 2026-10-15

## Authentication transactions (B-16 regression coverage; related auth hardening)

Inspection found the same transaction-ownership bug in seven authentication flows:
register, login, refresh, logout, logout-all, reset-password and change-password.
The catch block attempted ROLLBACK even when BEGIN failed or COMMIT had already
succeeded. A failing rollback could replace the original error, and the connection
was then released normally despite uncertain state.

The focused fix tracks open-transaction ownership and whether the client must be
discarded. Roll back only an open transaction; discard on failed BEGIN or failed
rollback; preserve the original failure. Never roll back committed work. Cleanup
failure is logged without raw database/provider error details. Authentication,
refresh-reuse revocation, password policy and audit behavior are otherwise preserved;
a failed post-commit signer/audit dependency is not silently reported as success.
The last-login timestamp update now uses the active login transaction instead
of a separate pool query; its optional-client contract preserves other callers.
No migration, data cleanup or new product policy was introduced.

Actual regression evidence:
- Before the fix, `cd backend && ./node_modules/.bin/vitest run tests/unit/auth-transactions.test.ts`
  FAIL: the first 18-test probe had 10 failures / 8 passes, demonstrating masked
  errors, invalid rollback ownership and lost-race rejection behavior.
- After the initial three-flow fix the same 18 units PASS. Inspection found the
  same pattern in the remaining four flows, which were then corrected/tested too.
- Final 39 tests in auth-transactions.test.ts PASS (37 lifecycle tests plus two
  last-login transaction-routing tests). They cover all seven flows'
  post-commit failure, failed BEGIN, ordinary rollback and failed rollback;
  refresh success/hash-only storage/absolute expiry; lost rotation race; detected
  reuse; and missing/revoked/expired/disabled inputs before connection/signing.
- These use the actual service with controlled pool/repository dependencies.
  They do NOT establish PostgreSQL locking, isolation, parallel rotation or
  network-failure behavior. Real database/security suites remain BLOCKED.

## Current-source secret detection (B-31 partial)

A separate lockfile-pinned Node >=22 developer toolchain lives in tools/security.
It is not installed in the application image. Install with lifecycle scripts disabled:

```
npm --prefix tools/security ci --ignore-scripts --no-audit --no-fund
npm --prefix tools/security audit --audit-level=high
node scripts/scan-secrets.mjs --self-test
node scripts/scan-secrets.mjs
```

The wrapper scans current tracked and nonignored untracked files, including
modified tracked files. Reviewed deletions are absent; ignored local runtime
credentials are not read. A symlink/unexpected inventory/tool error fails the gate
rather than silently skipping it. Inputs are literal absolute paths, not shell
patterns or options. Config/ignore files that upstream omits are scanned via STDIN
with an extension-preserving neutral filename; omissions are not treated as clean.
No detector exclusions/allowlist were added. The ignore file is intentionally empty.

Detector output stays in memory. Only file/rule/line/column metadata and totals are
printed, never sourceContent, matching values or detector messages. Default upstream
masking remains enabled as another layer. Do not publish raw CLI JSON: it can include
entire source text even when matching secret values are masked.

Self-test initially FAILed because the recommended private-key heuristic requires
at least 100 Base64 characters, while a real Ed25519 PKCS#8 key can be shorter.
A local parseable-private-key rule supplements, not disables, the preset. It uses
Node's private-key parser and emits no key value. Positive probes now cover real
ephemeral Ed25519, JSON-escaped Ed25519, RSA and a synthetic AWS secret pattern;
negative probes cover a public key and ordinary text. Self-test PASS.
An intermediate AWS ID probe was unsuitable because ID-only detection is off by
upstream default; the final probe uses a secret-key assignment instead. The rule
configuration was not weakened. Relative custom-rule resolution and upstream
omission of its own config files also initially failed closed and were corrected.

Actual source scan: **FAIL, 18 database-connection-string findings** in checked-in
.env.example files, CI, compose files and helper scripts. They include documented
local/example connection settings; a pattern match is NOT proof of a live leaked
credential. Their provenance/approved treatment still needs explicit review.
No finding was suppressed or automatically reclassified to make CI green. The
security-tool dependency audit PASS (zero reported vulnerabilities at execution).
C25 records the full actual installation/audit/probes/scan command and metadata-only
output. Source file counts can change as evidence/report files are generated.

An independent read-only CI workflow runs the same probes and source scanner; its
hosted execution is NOT RUN (no commit/push/dispatch performed). This does not add
Git-history, ignored-local-data, arbitrary binary/DER key, encrypted-key, container
image or comprehensive credential detection. The supplemental parser handles only
parseable unencrypted PEM keys. Git-history/container scanners remain NOT RUN.

## Export accuracy and missing-account race (B-18 / B-20 partial)

The legacy JSON endpoint actually returns profile, sessions, categories and
push-device metadata only. It never included tasks, notes, habits, events, ledger
records or other domain content. Removed the inaccurate complete/GDPR archive
promise from the OpenAPI response and mobile text. The UI now says metadata-only
and explicitly lists the limitation, including before optional clipboard consent.
The existing DTO shape and endpoint remain compatible; this is a disclosure fix,
not a full data-portability implementation.

The metadata query now selects only needed profile columns rather than fetching
password_hash with SELECT *. If the user disappears between authentication and
export, it returns controlled 404 before secondary reads rather than dereferencing
an absent row. Two SQL-harness tests PASS for that race, the selected columns and
identity predicates. They are not live PostgreSQL tests. Flutter execution remains
BLOCKED; WASM syntax parsing alone is not compiler/device verification.

Full domain export, bounded/streaming delivery, consistent snapshots, resource limits
and mobile secure-file integration remain open. No new endpoint, claimed stream,
background job or reusable export credential was fabricated. B-18 remains partial.

## Reconciled status

254 backend tests / 26 files PASS (41 net new tests since the 213-test delivery).
57 source audit records / 37 administrative overlap groups remain unchanged;
these extensions are not counted as additional independent findings or full closure.
Final per-command results are in checks.json. No real database, Redis, SMTP, Flutter,
native build or physical-device verification is claimed.


## Per-match credential provenance review and safe follow-up

# Review and replacement of the 18 source-secret matches — 2026-10-15

## Current outcome and limits

All 18 original URI findings were individually traced to then-tracked public development role defaults. The first review removed two unsafe helper literals and left 16 visible findings. That historical FAIL is preserved in verification-history.md and the JSON previous-review fields, not relabeled PASS. After explicit fresh-install authorization, the remaining tracked defaults were replaced coherently by generated local/per-job credentials; the actual current-source detector now reports zero findings, without detector exceptions. Final C25 evidence is authoritative for its scan inventory.

Current-source scanning is not Git-history, image, ignored-file or deployed-secret verification. The public ephemeral CI administrator fixture remains. Deployed reuse/rotation is BLOCKED; no deployed database, Docker or hosted pipeline was used. The later C32 uses new owned disposable database fixtures, not these deployed identities/configurations. No secret values appear in this record.

Original locations are historical, not current line locators. JSON retains original source hashes, previous-review source hashes/actions/outcomes, and current source fingerprints. These are file hashes, not password hashes. The 18 records are not new independent audit IDs.

## Per-match provenance and current action

| Record | Original location | Role | Previous match retained | Current action |
|---|---|---|---|---|
| SR-01 | .env.example:16 | lifestyle_app | true | Passwordless template and blank signing secrets; private fresh-install host.env provides matching generated settings. |
| SR-02 | .env.example:19 | lifestyle_migrator | true | Passwordless template and blank signing secrets; private fresh-install host.env provides matching generated settings. |
| SR-03 | .env.example:22 | lifestyle_maintenance | true | Passwordless template and blank signing secrets; private fresh-install host.env provides matching generated settings. |
| SR-04 | backend/.env.example:16 | lifestyle_app | true | Passwordless template and blank signing secrets; private fresh-install host.env provides matching generated settings. |
| SR-05 | backend/.env.example:19 | lifestyle_migrator | true | Passwordless template and blank signing secrets; private fresh-install host.env provides matching generated settings. |
| SR-06 | backend/.env.example:22 | lifestyle_maintenance | true | Passwordless template and blank signing secrets; private fresh-install host.env provides matching generated settings. |
| SR-07 | .github/workflows/ci.yml:85 | lifestyle_migrator | true | Per-job random application-role credentials registered with runner masking; public CI administrator fixture remains. |
| SR-08 | .github/workflows/ci.yml:96 | lifestyle_app | true | Per-job random application-role credentials registered with runner masking; public CI administrator fixture remains. |
| SR-09 | docker-compose.yml:66 | lifestyle_migrator | true | Required generated private settings, matching fresh role bootstrap and unique project namespace; no existing-volume password rotation. |
| SR-10 | docker-compose.yml:82 | lifestyle_app | true | Required generated private settings, matching fresh role bootstrap and unique project namespace; no existing-volume password rotation. |
| SR-11 | docker-compose.yml:110 | lifestyle_app | true | Required generated private settings, matching fresh role bootstrap and unique project namespace; no existing-volume password rotation. |
| SR-12 | docker-compose.yml:111 | lifestyle_maintenance | true | Required generated private settings, matching fresh role bootstrap and unique project namespace; no existing-volume password rotation. |
| SR-13 | docker/docker-compose.yml:66 | lifestyle_migrator | true | Required generated private settings, matching fresh role bootstrap and unique project namespace; no existing-volume password rotation. |
| SR-14 | docker/docker-compose.yml:82 | lifestyle_app | true | Required generated private settings, matching fresh role bootstrap and unique project namespace; no existing-volume password rotation. |
| SR-15 | docker/docker-compose.yml:110 | lifestyle_app | true | Required generated private settings, matching fresh role bootstrap and unique project namespace; no existing-volume password rotation. |
| SR-16 | docker/docker-compose.yml:111 | lifestyle_maintenance | true | Required generated private settings, matching fresh role bootstrap and unique project namespace; no existing-volume password rotation. |
| SR-17 | scripts/ensure-env.sh:36 | lifestyle_migrator | false | Prior helper default removal preserved; explicit guarded non-destructive/isolated flows unchanged. |
| SR-18 | scripts/verify-ci.sh:25 | lifestyle_migrator | false | Prior helper default removal preserved; explicit guarded non-destructive/isolated flows unchanged. |

## Safeguards and actual verification

- Existing production URI validation continues to reject known public defaults in runtime/migration/maintenance URIs, encoded/query forms and query-user bypasses. Its 26 backend regressions remain part of the backend unit suite; source provenance cannot certify actual production configuration.
- The fresh generator uses independent cryptographic randomness, ignored private files, exclusive creation and strict consistency loading. The stack wrapper pins a unique project and local socket and suppresses raw Docker output. No overwrite, deletion or existing-role rotation command is provided.
- C26: 17 existing helper/Compose-source/provenance tests. C27: 22 new temporary-filesystem, concurrent-process, private-config, local-CLI, CI-runner-file-fixture and Docker-command-spy/source tests. These are separate from backend units, not infrastructure tests.
- Bootstrap SQL requires credentials and a fresh-only acknowledgement; it refuses existing application roles/public objects/custom user schemas. It is transactional and has no ALTER ROLE path. Actual SQL/Compose execution is BLOCKED; hosted masking/isolation verification is NOT RUN.
- Existing installations require identified resources, verified backups, an isolated rehearsal and an explicitly approved coordinated role/client/key rotation plan. Generating new files does not change passwords stored in an existing volume.

See [fresh-local setup and upgrade safeguards](../development/local-setup.md), [database recovery](../database/migrations.md), and final `checks.json`/`evidence/C25-C27.txt`. Detector rules/ignore configuration were not weakened; ignored generated credentials are deliberately not tracked source.

## Follow-up: full local ancestry and CI source fingerprint chain — 2026-10-16

The earlier shallow Git scan (11 matches/one commit) is history, not current coverage.
After an unshallow fetch of the same baseline main, C36 scans 93 reachable commits /
1,033 unique UTF-8 blobs: 37 URI matches, eight skipped binary/non-UTF8 blobs, FAIL.
C38 verifies in memory that every match equals a baseline development-role default
at an approved historical source path with only a loopback/Compose host and no URI
query/fragment override. All 37 provenance comparisons PASS; all deployed-reuse
verdicts remain BLOCKED. This is **not** a clean-history verdict, secret revocation,
provider test, or certification that defaults were not reused. No values are emitted.
See history-provenance.json and runtime-and-cleanup.md. These historical unique-blob
matches are separate from the 18 original source-location records, not new audit IDs.

The pre-device CI signing/validation edit changes `.github/workflows/ci.yml` without
restoring its old role defaults. SR-07/SR-08 retain all original/previous/fresh-setup
fingerprints, with an appended dated `source_followups` chain and reason. C26 checks
each prior-to-next fingerprint and current bytes; no original record is renumbered,
removed or blindly replaced. The current-source detector remains authoritative for
current tracked source, separately from historical or deployed configurations.


## Streamed account-domain archive: implementation and remaining verification

# Version-1 streamed account domain archive

## Implemented scope and remaining verification

`POST /api/v1/users/me/export/archive` is an additive backend NDJSON attachment.
The old `POST /users/me/export` remains a four-section metadata response for existing
clients; its three lists now each fetch at most 1001 rows and return 413 above 1000,
not a silently truncated result. It is not a consistent full-domain snapshot.

The new archive has 21 explicit profile/domain/metadata projections, covering every
currently user-owned domain table plus profile/session metadata. It includes tasks,
recurring tasks/rules, timers, habits/check-ins, goals/milestones, projects, notes/
links, events, categories, transactions, subscriptions, budgets and reminders, plus
sanitized session/push/ingest-device metadata. Existing soft-deleted rows are included;
already purged data cannot be recovered. No retention policy or historical monetary
value is changed. Future tables/fields require explicit projection/security review.

Backend SQL/control-flow, HTTP and cancellation tests execute with controlled
fixtures. Three live checks (two repository snapshot/grants/tenancy cases and one users-flow
HTTP/grace-period case) now execute against process/data-directory-proven owned
PostgreSQL/Redis in C15/C32. Docker and deployment/proxy/device verification remain
BLOCKED; the hosted workflow is NOT RUN. Android incremental parsing, encrypted private staging and explicit document saving
are now integrated in source (see `../mobile/account-archive.md`). The original
metadata UI remains a separate action. Eight Node fixture/source checks and ten
actual Android-free JVM staging checks execute, but Flutter tests, Android bridge/
app compilation and provider/device verification remain BLOCKED. This is not complete
end-to-end portability or release approval.

## Request security and compatibility

Authentication and strict `{ "currentPassword": "..." }` proof are required. The
caller cannot choose another identity, table, projection, size or filename. Export,
legacy metadata and account deletion share the existing fail-closed reauthentication
budget (five attempts per 15 minutes). A failed security limiter stops work before
password checking or database acquisition. The new route is explicitly allowed in
the same deletion-grace scope as the existing metadata export; disabled accounts
remain blocked by authentication. No credentials are accepted in query strings.

Success headers: `application/x-ndjson; charset=utf-8`, fixed attachment filename
`lifestyle-domain-archive-v1.ndjson`, `Cache-Control: no-store`, and
`X-Accel-Buffering: no`. Reverse-proxy behavior still needs deployment verification.
Do not put password proof in shell history, logs, URLs or an example curl command.
There is no export queue, download token, retained server archive or automatic
clipboard write. TLS and client-side secure storage remain deployment requirements.

## Format and validation

Each frame is one UTF-8 JSON object followed by exactly one LF byte:

1. `type=manifest`: format `lifestyle-domain-archive`, version 1, generation timestamp,
   snapshot mode, ordered sections, exclusions, numeric encoding and limits.
2. `type=record`: `section` and a `data` object with explicit PostgreSQL snake_case
   field names. Ordering is by section then primary-key id. Empty sections have zero
   records but remain listed in the manifest and footer counts. Relationships keep
   their IDs. PostgreSQL numeric amounts/goal values are cast to **decimal strings**
   before JSON construction, avoiding JS floating-point loss. Dates/timestamps use
   PostgreSQL JSON strings with the transaction timezone set to UTC.
3. `type=complete`: per-section `counts`, total `records`, `bytesBeforeComplete`, and
   lowercase hexadecimal `sha256` over the exact bytes of every preceding frame,
   including their LF bytes. The footer itself is not hashed or counted in that
   byte total; it is emitted only after successful COMMIT and the generation audit
   call. The existing audit logger remains best-effort; this is not durable audit
   certification or proof that the client received/saved the file.

A client MUST require one supported manifest, known sections, matching frame counts,
byte count and SHA-256, and exactly one final completion frame before accepting a
saved archive. HTTP 200 or socket EOF alone is insufficient. A hash detects byte
corruption, not malicious replacement; it is not a digital signature. Do not show
success or import a partial archive. Keep bytes unchanged when verifying (no newline,
Unicode, whitespace or decimal normalization). Android source now implements these checks; actual Flutter/bridge/device behavior
is not implied by backend, Node source checks or Android-free JVM tests.

## Exclusions

No password hashes, push delivery tokens, authentication/refresh/ingest token material,
internal idempotency fingerprints, generated search vectors, internal delivery error
payloads, audit logs, Redis/queue state, external-provider or device-only data are
exported. The manifest discloses these exclusions. This is the reviewed version-1
**domain** scope, not a claim to every infrastructure record or every legal request.
User-authored text can itself be sensitive; the resulting plaintext attachment must
be treated as personal data, never logged/uploaded as a test artifact.

## Consistency, resource limits and failures

One dedicated connection uses `REPEATABLE READ READ ONLY`; each source has a bounded
32-row server cursor fetch. Server-side projection returns a null size sentinel for
projected JSON over 512 KiB, instead of sending an unlimited row to Node. A whole
archive is capped at 128 MiB including reserved footer space, with a 60-second
request budget, five-second query deadline and server statement timeout, ten-second
idle-transaction timeout, and at most two active database archive readers per API process/one per
user per process. Capacity is released after database generation, before audit/footer
delivery; this is not a cap on all open HTTP responses. The process cap is not a cluster-wide semaphore. Pool acquisition
uses the existing five-second connection timeout. Large/slow exports fail explicitly;
no resume/background fallback is claimed. These limits may require a later reviewed
large-account mechanism, not silent omission or relaxation.

The HTTP writer honors backpressure before requesting more data. Client disconnect,
query/overall timeout or asynchronous checked-out-client failure terminates the
stream and releases/discards its connection; ordinary early iterator return rolls
back. An async pg error listener prevents an idle-transaction disconnect while
backpressured from becoming an unhandled process error. Stalled audit waiting is
abortable, but this does not claim cancellation of the existing audit logger's
underlying query or guaranteed physical server cleanup under a network outage.

Before response headers, strict validation/authentication, missing-account, capacity,
size and database errors use ordinary sanitized error responses (400/401/403/404/
429/413/503). After headers, errors destroy the response without an error payload or
completion footer. The overall HTTP deadline can also close the connection without
an error envelope. Never reinterpret a partial stream as a successful smaller export.
Real SQL/projection/snapshot/tenancy and runtime grants now have owned-fixture C15/C32
evidence. Deployed schema/grants, proxy behavior, outages/server cleanup under network
failures and native/device behavior still require their separate runtime/release gates.


## Android stream verification, encrypted staging and explicit save: scoped evidence

# Android account-domain archive: source integration and verification limits

## Current status

An additional profile action now connects the mobile client to
`POST /api/v1/users/me/export/archive`. The original metadata/optional clipboard
flow remains separate and unchanged in intent; it is not silently substituted for
an unsuccessful archive. Android is the only implemented file-save adapter. Other
platforms show unsupported and do not start a download. No release readiness,
physical-device success, Flutter compilation or Android bridge compilation is claimed.

Actual executed evidence is deliberately separated:
- C29: eight Node synthetic-wire-fixture/source-contract checks, **not Dart execution**.
- C30: ten checks compile and execute the actual Android-free `AccountArchiveStage`
  Kotlin implementation on a scratch JVM with real AES-GCM/file I/O. They cover
  roundtrip/readback, pre-seal refusal, wrong size/hash, bounds, tampering, truncation,
  revocation and multi-chunk behavior. They do **not** execute Android providers,
  the Activity/MethodChannel bridge, backup/OEM behavior or the UI.
- C12: WASM Dart syntax parsing only, including new source/test files.
- C15/C32 now execute live archive SQL/snapshot/grants/tenancy and grace-period
  HTTP cases in owned PostgreSQL/Redis fixtures, not Android end-to-end behavior.
- Flutter resolution/analysis/widget/transport/verifier tests, full Android build,
  document-provider/lifecycle tests and physical-device verification remain BLOCKED.
  New Flutter files author 13 protocol/coordinator, nine transport and three widget
  cases (25 total), not counted as passing tests. Hosted CI is NOT RUN.

## Request, consent and validation

The new dialog asks for the current password and explicit acknowledgement of personal
content, plaintext-destination, backup/sync and interrupted-file risks before download.
The password field is cleared on submission and disposed with the route. This is not
secure erasure of immutable Dart/HTTP strings; they are never intentionally persisted,
logged, previewed or placed on the clipboard. Existing localization fallback supplies
English strings; new full translations are not claimed.

The API transport uses a dedicated HTTP client, disables redirects, retains the
existing coalesced refresh-token path only for one explicit pre-body TOKEN_EXPIRED,
and never retries a partial stream or an uncertain response. The shared API client
is not closed by an export cancellation. It bounds error bodies to 64 KiB, sends
chunks of at most 32 KiB, applies header/idle/overall download timeouts, and closes
the dedicated connection on disposal/cancellation. An already-started shared refresh
operation is not cancelled/replayed by this feature. Existing auth concurrency and
real networking behavior still require runtime verification.

The incremental verifier checks strict UTF-8 JSON framing, supported format/version,
the exact 21 version-1 sections, the expected authenticated profile ID, ordered unique
row IDs, decimal-string fields and known forbidden credential columns. It requires
one profile, matching per-section/total counts, exact pre-footer UTF-8 byte count and
SHA-256, a single final completion footer, final LF and no appended bytes. It applies
chunk/line/record-frame/128-MiB limits without retaining an entire archive. The hash
is a corruption check, not a digital signature or authentication of a malicious
server; TLS/authentication and server projection/tenancy controls remain required.
User-authored text may itself contain secrets and must be treated as personal data.

No unverified archive is offered to the document chooser. Only EOF plus a valid
completion footer permits sealing the staged file and enabling a separate Save
button. Missing footer, wrong hash/count/version/identity, invalid UTF-8, oversized
input, stream failure or cancellation must not become a smaller successful export.
The native stage also checks the exact whole-file byte count/hash, including the
footer, against bytes actually staged over the platform channel.

## Bounded encrypted staging (not a production secret manager)

The Android bridge creates one opaque UUID-named stage in the new feature's private
`noBackupFilesDir/account_archive_v1` directory. There is no plaintext app-cache
file, external path argument or persistent decryption key. A cryptographically random
256-bit key stays in process memory. Each bounded chunk has its own AES-GCM nonce/tag
and associated session/index data; decryption authenticates each chunk independently
rather than relying on a whole-file-buffering CipherInputStream. Plaintext is capped
at 128 MiB, codec chunks at 32 KiB, and encrypted record count at 8192. A process-wide
ownership registry prevents multiple Activities from adopting/deleting an active
stage. It is not a cross-process/privileged-attacker security boundary.

Cancel, failure, screen disposal/account switch, Activity destruction and success
request cleanup of the owned stage. A ten-minute native expiry requests revocation
and cleanup; next bridge creation removes only orphan UUID `.enc` files in this
new directory, never recursively other app/user data or another active stage.
Failed orphan deletion blocks creation rather than growing more owned stages.
Keys are best-effort cleared and never written to disk; JVM/provider internal copies,
RAM compromise, OS snapshots and flash secure erasure are not certified. An orphan
ciphertext file can remain after an I/O/cleanup failure or process death. No policy
for retaining/purging application records has changed.

Native provider I/O is off the main thread. Revocation/CancellationSignal is best
effort: a stalled or noncompliant provider can delay return/cleanup, and the ten-minute
expiry is not a proved hard interruption of every OS I/O operation. Safe fixed
warnings/errors report cleanup problems without URI, path, password or content.
No success means verified cleanup is inferred from a swallowed exception.

## Explicit user-chosen plaintext destination

Save opens Android ACTION_CREATE_DOCUMENT with a fixed filename/MIME and ephemeral
read/write access to the selected new document only. No storage permission,
FileProvider, persistent URI grant, file_picker import or new accessibility/device-
admin capability is added. This adapter does not use file_picker. The owner later clarified that existing
local audio selection is permitted while server uploads stay forbidden; C10 now
uses a scoped declaration/consumer rule, not a global allowlist. See
`../security/local-audio-boundary.md`. This does not verify native picker behavior.

The chosen document is **plaintext**, not the encrypted stage. Its provider can be
local/cloud-backed, backed up or synced; the consent text discloses this. The adapter
copies authenticated chunks, closes the writer and streams a readback to compare
exact byte count/hash before reporting saved. This confirms the provider's observed
readback, not long-term durability or absence of remote copies. A provider that
cannot support readback fails rather than fabricate success. Picker cancellation
is a distinct non-success outcome and may retain the encrypted stage for an explicit
retry until close/expiry.

On a failed write/readback, deletion is attempted only for that newly chosen document.
A provider can refuse or stall: the UI says no save is confirmed and warns that an
empty/partial destination may remain for manual checking/removal. Closing the dialog
cannot revoke a finished copy, cloud/backup history or guarantee interruption at an
exact byte. No complete archive is copied to the clipboard or previewed in the UI.

## Required runtime checklist before release

1. Resolve the pinned crypto declaration with Flutter, analyze without suppressions,
   and execute all existing/new tests. The crypto version/hash was already in the
   lockfile; only its direct dependency declaration changed. No pub-get PASS inferred.
2. Compile the full Android app/bridge and JVM suite on the actual project toolchain;
   test supported API levels/OEMs and verify no additional permission prompt appears.
3. Against verified disposable backend resources, exercise the real streaming API,
   token expiry/refresh, non-ASCII/multi-chunk rows, large accounts/limits and tenancy.
4. On physical devices test local and cloud document providers, readback denial,
   quota/disk-full/write errors, chooser cancellation, activity recreation/destruction,
   logout/account switch, background/foreground and timeout during download/write.
5. Inspect private staging, backup/device-transfer behavior and cleanup after crash/
   expiry and failed deletion. Check partial destination warnings, no implicit copy,
   no personal data in logs, and no success before footer/native readback.
6. Verify signed-release/device behavior. Android/source/JVM subsets do not establish
   other-platform support or end-to-end portability. Large-account resumable export,
   other-platform adapters and retention policy decisions remain open; the local-only
   audio policy clarification does not approve server uploads or prove native behavior.

Reproduce the scoped JVM gate with `python scripts/check-archive-stage.py` after
installing scratch Kotlin compiler 2.4.21 and jdk4py 17.0.9.2 outside the repository,
or set `ARCHIVE_JAVA_HOME`/`ARCHIVE_KOTLIN_COMPILER` to reviewed local tools. This is
sandbox test tooling, not an application dependency or certification of that JDK's
patch level. The harness owns/removes only its temporary encrypted fixture files/JAR;
it never contacts an app service or device. The backend protocol remains documented
in `../api/account-archive.md`.


## Money semantics

Backend DTOs use currency exponents (JPY=0, KWD=3, CLF/UYW=4, others normally 2), decimal.js HALF_UP and string amounts; inputs validate before storage and idempotent posting. Mobile four-place BigInt arithmetic removes double monetary sums; totals are grouped by currency, active subscriptions use server monthlyEquivalent and only bounded progress becomes double. Five new mobile money tests are authored but BLOCKED from execution. There is no bulk historical ledger conversion, FX assumption or migration of financial values. Existing records may reflect earlier rounding; actual deployed-data reconciliation remains necessary.

## Digital Detox — capability gate, safety and incomplete work

# Digital Detox — implementation gate and safety contract (2026-10-15)

## Discovered architecture / capability gate (before enforcement implementation)
Flutter + Riverpod. Android is the only native target checked in: no ios directory,
FamilyControls entitlement, ManagedSettings integration, or DeviceActivity extension.
Existing Focus Shield uses a user-enabled Android AccessibilityService to redirect
selected foreground app windows to HOME. It is not device-owner package suspension.
No new accessibility service, device administrator, or usage tracking is introduced.

| Actual configuration | Full-device request | Selected-app request |
|---|---|---|
| Android consumer app | **Partial**: explicitly labelled Strict Focus alternative, redirects visible launchable non-safety apps. Does not lock device. | **Partial**: existing accessibility redirect for selected launchable non-safety apps. Not OS package suspension. |
| iOS (no native target) | **Blocked**: ordinary apps cannot lock the device; no integration. | **Blocked**: would require FamilyControls authorization/distribution entitlement, ManagedSettings and DeviceActivity extensions plus device verification. |
| Other Flutter targets | **Blocked**: native integration absent. | **Blocked**: no fabricated application list. |

All current Android enforced sessions report FOCUS_PARTIAL, never FOCUS_ACTIVE.
A connected service and persisted native owner are checked, but that is NOT proof
that every future launch will be intercepted. Accessibility can be disabled by the
user, OEMs may terminate it, and Android settings, emergency calling, dialers,
keyboards, launcher, permissions UI and LifeStyle remain accessible. Distribution
policy review and physical-device verification are release gates. No new sensitive
permissions are requested automatically. Explain scope before opening Android settings.

## Session design
Explicit transition graph in detox_session.dart; invalid transitions throw.
Defaults 45/15 minutes; focus 1–180 and break 1–60 minutes. Repeat is intentionally
not automatic. At break end complete; Continue explicitly starts a new cycle.
Pause first releases owned restrictions and freezes remaining time. Resume reapplies
before declaring the actual focus status. Stop releases only this owner. Release
failure stays ERROR, not a false unrestricted break/stop.

Secure storage holds a versioned snapshot per authenticated account (no guest
sessions). Timestamps, phase, durations, paused remaining time, selected package IDs,
restriction result and last transition persist. No usage or notification content.
An app-lifetime Riverpod controller serializes operations; the UI ticker is not the
source of time. Startup, resume, and delayed ticks reconcile against native state.
Native expiry releases without Flutter. There is no automatic background restart
of a focus cycle. Native elapsed realtime and boot count invalidate stale restrictions
on reboot or significant clock changes; the safest policy is release, not re-lock.
Break begins at the actual confirmed release, not a fabricated past release time.
Secure-store corruption is reported, and native Detox-owned state is safely released.
Existing Focus Shield sessions are not stopped by Detox's owner-scoped operations.
Signing out already stops native shielding; the Detox snapshot is discarded on logout.

## Verification and remaining requirements
Flutter/Dart/Android SDKs and a physical device are unavailable in this sandbox.
Tests added are NOT RUN until CI/device verification; neither mode is fully delivered
or release-approved. Verify real app selection, permission denial/revocation, HOME
redirects, emergency/essential app safety, expiry with app killed, reboot, time changes,
pause/break/stop release, screen navigation and competing Focus Shield sessions.
For genuine Android OS suspension a separately approved managed-device deployment
would need device-owner provisioning. Do not silently add that privilege here.
For iOS add an actual native target, acquire Apple's distribution entitlement,
implement system FamilyActivityPicker + ManagedSettings + DeviceActivity extensions,
and test release/recovery on devices before reporting support.


## Ingest storage remediation compatibility
The session-bound wallet ingest credential now uses AES-GCM with a non-exportable
Android Keystore key, shared by the receiver and a native method channel. Flutter
receives only a presence flag on reads. Successful encrypted writes remove the legacy
plaintext token; failures do not silently downgrade storage. Other native targets use
FlutterSecureStorage. Backup and device-transfer exclusions cover all app domains.
Native Keystore migration/device behavior is unverified here. Financial SMS candidate,
review and pending-transaction queues remain plaintext in private app preferences;
root/compromised-device access and indefinite local retention remain residual B-01/R-08
risks. Do not describe all local SMS storage as encrypted.


## Per-command final evidence

### C01 — PASS

Command: npm --prefix backend ci --no-audit --no-fund

Exit code: 0. Scope: Lockfile installation, including native bcrypt install.

Evidence: docs/remediation/evidence/C01.txt

### C02 — PASS

Command: npm --prefix backend run typecheck

Exit code: 0. Scope: Production source strict compilation.

Evidence: docs/remediation/evidence/C02.txt

### C03 — PASS

Command: npm --prefix backend run typecheck:tests

Exit code: 0. Scope: Strict compilation includes all unit/integration/security test sources.

Evidence: docs/remediation/evidence/C03.txt

### C04 — PASS

Command: npm --prefix backend run lint

Exit code: 0. Scope: 

Evidence: docs/remediation/evidence/C04.txt

### C05 — PASS

Command: npm --prefix backend run format:check

Exit code: 0. Scope: 

Evidence: docs/remediation/evidence/C05.txt

### C06 — PASS

Command: npm --prefix backend run test:unit

Exit code: 0. Scope: Only unit tests; inert endpoints and in-memory OTP.

Evidence: docs/remediation/evidence/C06.txt

### C07 — PASS

Command: npm --prefix backend run build

Exit code: 0. Scope: 

Evidence: docs/remediation/evidence/C07.txt

### C08 — PASS

Command: npm --prefix backend audit --omit=dev --audit-level=high

Exit code: 0. Scope: Production dependency audit; not a full supply-chain certification.

Evidence: docs/remediation/evidence/C08.txt

### C09 — PASS

Command: npm --prefix backend run openapi:generate

Exit code: 0. Scope: Generator executes; generated file must match the intentionally updated contract.

Evidence: docs/remediation/evidence/C09.txt

### C10 — PASS

Command: node scripts/check-forbidden.mjs

Exit code: 0. Scope: Owner-authorized local-only audio declaration/consumer exception; no global file_picker allowlist, server upload dependencies remain forbidden. Actual guard result, not native/network certification.

Evidence: docs/remediation/evidence/C10.txt

### C11 — PASS

Command: cd backend && ./node_modules/.bin/vitest run tests/integration/health.test.ts

Exit code: 1. Scope: Expected nonzero refusal before integration file import/cleanup; NOT an integration test success.

Evidence: docs/remediation/evidence/C11.txt

### C12 — PASS

Command: node scripts/check-dart-syntax.mjs /home/user/tooling/node_modules/@wasm-fmt/dart_fmt/dart_fmt_node.js

Exit code: 0. Scope: Scratch npm @wasm-fmt/dart_fmt@0.4.0. Syntax only; Flutter SDK absent.

Evidence: docs/remediation/evidence/C12.txt

### C13 — PASS

Command: git diff --check

Exit code: 0. Scope: Tracked diff whitespace/error check; packaging verifies new files separately.

Evidence: docs/remediation/evidence/C13.txt

### C14 — PASS

Command: /home/user/.venv/bin/python scripts/package-remediation.py --output /home/user

Exit code: 0. Scope: Actual ZIP CRC, exact changed/new inventory, per-entry SHA-256, explicit reviewed deletions and PDF extraction verified; patch set, not full repository.

Evidence: docs/remediation/evidence/C14.txt

### C15 — PASS

Command: npm run test:integration (owned C32 services only)

Exit code: not executed. Scope: Actual integration suite, disposable current-schema fixtures only; not deployed data or Flutter E2E.

Evidence: docs/remediation/evidence/C32.txt

### C16 — PASS

Command: npm run test:security (owned C32 services only)

Exit code: not executed. Scope: Actual current security suite, not exhaustive penetration/provider/device testing.

Evidence: docs/remediation/evidence/C32.txt

### C17 — PASS

Command: Owned C32 bootstrap/fresh/repeat/synthetic-populated/failed migration and grant probes

Exit code: not executed. Scope: Actual PostgreSQL fixtures and psql bootstrap. Not an upgrade rehearsal against actual deployed legacy history/data; that remains C35 BLOCKED.

Evidence: docs/remediation/evidence/C32.txt

### C18 — BLOCKED

Command: docker compose config && docker compose build && docker compose up

Exit code: not executed. Scope: Docker executable/daemon unavailable.

Evidence: No execution log; blocked/not attempted.

### C19 — BLOCKED

Command: cd mobile-app/mobile && flutter analyze --fatal-infos

Exit code: not executed. Scope: Flutter/Dart SDK unavailable; WASM parse is not analysis.

Evidence: No execution log; blocked/not attempted.

### C20 — BLOCKED

Command: cd mobile-app/mobile && flutter test

Exit code: not executed. Scope: Flutter SDK unavailable, including Digital Detox, wallet and 25 new archive protocol/transport/widget cases.

Evidence: No execution log; blocked/not attempted.

### C21 — BLOCKED

Command: cd mobile-app/mobile && flutter build apk --release; Android JVM tests and signature verification

Exit code: not executed. Scope: Flutter/Android SDK and signing credentials unavailable. Scratch Java/Kotlin execute the Android-free stage only in C30; bridge/app compilation remains BLOCKED.

Evidence: No execution log; blocked/not attempted.

### C22 — BLOCKED

Command: Physical-device restriction/backup/Keystore/archive document-provider/lifecycle/SMTP verification checklist

Exit code: not executed. Scope: No physical device/emulator or SMTP provider access/credentials. Real delivery and device enforcement unverified.

Evidence: No execution log; blocked/not attempted.

### C23 — NOT RUN

Command: Full application end-to-end suite

Exit code: not executed. Scope: No E2E execution attempted; native and infrastructure prerequisites not satisfied.

Evidence: No execution log; blocked/not attempted.

### C24 — NOT RUN

Command: Container-image security scanners / hosted CI execution

Exit code: not executed. Scope: No Docker images/hosted execution. Current source is C25 and local reachable Git text history C36; B-31 stays partial.

Evidence: No execution log; blocked/not attempted.

### C25 — PASS

Command: npm --prefix tools/security audit --audit-level=high && node scripts/scan-secrets.mjs --self-test && node scripts/scan-secrets.mjs

Exit code: 0. Scope: Current-source only; real detector probes, no allowlist, metadata-only output. Original 18 provenance records and historical 18/16 findings remain in secret-triage.json; current-source result does not assess deployed reuse, Git history, images or generated private configuration.

Evidence: docs/remediation/evidence/C25.txt

### C26 — PASS

Command: bash -n scripts/ensure-env.sh scripts/verify-ci.sh && node --test scripts/check-environment.test.mjs

Exit code: 0. Scope: 17 local configuration/command-spy/provenance/Compose source tests; no actual migrations, Docker networking or infrastructure suite success implied.

Evidence: docs/remediation/evidence/C26.txt

### C27 — PASS

Command: node --check scripts/local-setup.mjs && node --check scripts/local-stack.mjs && node --check scripts/ci-database-env.mjs && node --test scripts/local-setup.test.mjs

Exit code: 0. Scope: 22 fresh-setup/private-file/CI-fixture/command-spy/source tests in owned temporary directories only. No real Docker, PostgreSQL, migrations or hosted runner verification.

Evidence: docs/remediation/evidence/C27.txt

### C28 — PASS

Command: node --check scripts/ci-resource-guard.mjs && node --test scripts/ci-resource-guard.test.mjs

Exit code: 0. Scope: 16 hosted-resource guard/negative/source tests with Docker command spies only. Hosted workflow itself NOT RUN; these are command spies only. Actual archive/infrastructure execution is separately C15/C32, not inferred from C28.

Evidence: docs/remediation/evidence/C28.txt

### C29 — PASS

Command: node --test scripts/archive-mobile-contract.test.mjs

Exit code: 0. Scope: 8 synthetic archive-wire-fixture/source-contract checks. Not Dart execution, Android bridge compilation or document-provider/UI integration.

Evidence: docs/remediation/evidence/C29.txt

### C30 — PASS

Command: python scripts/check-archive-stage.py

Exit code: 0. Scope: 10 real JVM crypto/file-I/O checks compiling the actual Android-free Kotlin stager. Android bridge, document providers, Activity lifecycle, Flutter and physical-device behavior NOT RUN; not a native app build.

Evidence: docs/remediation/evidence/C30.txt

### C31 — PASS

Command: node --test scripts/check-forbidden.test.mjs

Exit code: 0. Scope: 21 scoped policy negative/source/actual-CLI fixture checks. No production upload/device/network observation implied; C06 also executes 13 real JSON-only middleware checks.

Evidence: docs/remediation/evidence/C31.txt

### C32 — PASS

Command: python scripts/run-disposable-verification.py

Exit code: 0. Scope: Actual owned PostgreSQL16/Redis7 bootstrap/migration/grants/integration/security harness. No Docker, deployed legacy data, native device or real SMTP delivery certification.

Evidence: docs/remediation/evidence/C32.txt

### C33 — PASS

Command: node --test scripts/native-voice-cleanup.test.mjs

Exit code: 0. Scope: 8 native voice cleanup/source-contract checks only. No Kotlin Android compile or speech/notification/lifecycle/device execution.

Evidence: docs/remediation/evidence/C33.txt

### C34 — PASS

Command: npm --prefix backend run typecheck -- --noUnusedLocals --noUnusedParameters

Exit code: 0. Scope: Actual strict TypeScript unused-local/parameter check; no backend source candidates removed without compiler evidence.

Evidence: docs/remediation/evidence/C34.txt

### C35 — BLOCKED

Command: Actual legacy deployment migration/restore rehearsal

Exit code: not executed. Scope: Actual deployed legacy schema/history, backup and target unavailable. Owned current-schema fixture C17 does not certify real deployment/restore. No user database contacted.

Evidence: No execution log; blocked/not attempted.

### C36 — FAIL

Command: python scripts/scan-git-history.py

Exit code: 1. Scope: Actual unique UTF-8 Git blobs in locally reachable refs only; binary/large/non-UTF8/unfetched/unreachable/image/runtime contents excluded explicitly. Historical matches FAIL pending operational assessment, not proof of live reuse.

Evidence: docs/remediation/evidence/C36.txt

### C37 — PASS

Command: node --check scripts/prepare-android-signing.mjs && node --check scripts/verify-android-apk.mjs && node --test scripts/android-build-preparation.test.mjs

Exit code: 0. Scope: 13 real private-filesystem/negative/parser/source/YAML/bash/conditional-copy and missing-SDK CLI-refusal checks. Synthetic byte/certificate fixtures are not a key, real APK, Gradle execution, hosted runner or Android signature verification PASS; these remain C21/C24.

Evidence: docs/remediation/evidence/C37.txt

### C38 — PASS

Command: python scripts/review-history-provenance.py --self-test && python scripts/review-history-provenance.py

Exit code: 0. Scope: Strict negative provenance self-test and actual in-memory comparison of every C36 match with baseline development-role definitions/local service hosts. Metadata only; C36 stays FAIL. Deployed reuse/rotation remains BLOCKED, original 18 source records preserved separately.

Evidence: docs/remediation/evidence/C38.txt

## Complete source-finding traceability

Linked IDs share scope; no finding is counted twice as an independent defect. Each record preserves the actual source description, severity, current status, root cause, action, affected paths, regression scope and final disposition.

### P0-01 — Unauthenticated health/migrate DDL and stack disclosure

Source severity: Critical (P0)

Overlap group: P0-01

Current code: already fixed

Root cause: Health router exposes live/ready only; startup no DDL.

Action and residual scope: Preserved. Real router removal test executes without database.

Regression evidence: Unit 404/no startup DDL guard; deployed image unknown.

Disposition: fixed_verified

Affected / inspected files: backend/src/features/health/health.routes.ts; backend/tests/unit/startup-ddl-guard.test.ts

### B-01 — Mobile tokens in plaintext preferences and default backup scope

Source severity: High (P1)

Overlap group: B-01

Current code: confirmed

Root cause: Access/refresh already in secure storage. Ingest token and SMS queues still used preferences.

Action and residual scope: Keystore AES-GCM native ingest credential + migration; backup/device-transfer exclusions. SMS queues remain private plaintext.

Regression evidence: Wallet tests updated with injected credential store; native migration/backup/device tests BLOCKED.

Disposition: partial

Affected / inspected files: mobile-app/mobile/lib/data/token_store.dart; mobile-app/mobile/lib/features/money/data/wallet_ingest_token.dart; mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/WalletCredentialStore.kt; mobile-app/mobile/android/app/src/main/AndroidManifest.xml

### B-02 — Gemini API key compiled into release app

Source severity: High (P1)

Overlap group: B-02

Current code: already fixed

Root cause: app_config.dart disables compile-time key in release; secure BYOK storage and logout clearing present.

Action and residual scope: Preserved release key guard; no reimplementation.

Regression evidence: Release extraction and Flutter tests BLOCKED.

Disposition: code_unverified

Affected / inspected files: mobile-app/mobile/lib/config/app_config.dart; mobile-app/mobile/lib/features/ai/data/ai_service.dart

### B-03 — SMS capture conflicts with original D-09 exclusion

Source severity: High (P1)

Overlap group: B-03

Current code: already fixed

Root cause: ADR-044 records scope approval; actual historical approval event cannot be independently authenticated.

Action and residual scope: Preserve recorded decision; no invented approval.

Regression evidence: Policy record inspection only; device opt-in flow BLOCKED.

Disposition: code_unverified

Affected / inspected files: docs/architecture/design-decisions.md; mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/SmsTransactionReceiver.kt

### B-04 — AI features conflict with D-07 exclusion

Source severity: High (P1)

Overlap group: B-04

Current code: already fixed

Root cause: ADR-044 records exceptions; server SMS key and BYOK guard remain. Voice not explicitly named.

Action and residual scope: Preserve AI approval record; add truthful voice clarification without retroactive approval.

Regression evidence: External provider/device flows BLOCKED; R-22 unresolved scope.

Disposition: partial

Affected / inspected files: docs/architecture/design-decisions.md; mobile-app/mobile/lib/features/ai/data/ai_service.dart

### B-05 — Arabic default/RTL/extra locales conflict with English-only policy

Source severity: High (P1)

Overlap group: B-05

Current code: already fixed

Root cause: ADR-044 records multi-language approval. Registered locales are six, not eleven.

Action and residual scope: Preserve architecture, correct six-locale implementation documentation.

Regression evidence: Static locale inventory; Flutter/RTL device checks BLOCKED.

Disposition: code_unverified

Affected / inspected files: docs/architecture/deferred-and-non-goals.md; docs/mobile/flutter-integration.md; mobile-app/mobile/lib/l10n/app_localizations.dart

### B-06 — Dashboard and Daily Plan missing/incomplete

Source severity: High (P1)

Overlap group: B-06

Current code: confirmed

Root cause: Backend readers exist; client calls nonexistent dashboard root; minor-unit summaries used Number*100.

Action and residual scope: Use registered /dashboard/overview and string/currency-exponent money contract; preserve authenticated routes.

Regression evidence: Real-router success/401/failure and exact arithmetic PASS; Flutter widget/API+DB tests BLOCKED.

Disposition: code_unverified

Affected / inspected files: backend/src/features/dashboard/dashboard.service.ts; backend/src/features/money/money.reader.ts; mobile-app/mobile/lib/features/more/data/daily_plan_models.dart

### B-07 — Account erasure and retention purges do not execute completely

Source severity: High (P1)

Overlap group: B-07

Current code: confirmed

Root cause: Worker scheduling exists; duplicate account purge, missing upgrade grant, silent soft purge errors; audit/session retention absent.

Action and residual scope: Consolidate account purge into tested UsersRepository; propagate errors; forward grant repair. No new audit/session deletion implemented without database verification.

Regression evidence: Account deletion unit tests PASS. Real populated purge, 12-month audit retention and expired-session cleanup remain open/BLOCKED. Current C15/C32 executes real owned-database scheduling/grace-period/purge/worker integration; an initial 3-case deletion failure exposed invalid paginated DELETE, now fixed with an added unit and all 154 integration cases passing. Retention policy remains unresolved, no user data touched.

Disposition: partial

Affected / inspected files: backend/src/jobs/job-stores.pg.ts; backend/src/features/users/users.repository.pg.ts; backend/src/infrastructure/database/postgres/migrations/1792022400000_ingest_delete_grant.cjs; scripts/run-disposable-verification.py; docs/remediation/runtime-and-cleanup.md

### B-08 — Recurring tasks stop after first seven days

Source severity: High (P1)

Overlap group: B-08

Current code: already fixed

Root cause: Hourly rolling horizon generator with occurrence limits and conflict handling already present.

Action and residual scope: Preserved existing fix.

Regression evidence: Recurrence unit tests PASS; populated worker generation and per-template failure isolation not verified.

Disposition: code_unverified

Affected / inspected files: backend/src/worker.ts; backend/src/jobs/job-stores.pg.ts; backend/src/features/recurring-tasks/recurrence-engine.ts

### B-09 — Boot DDL/schema drift/runtime superuser allowed

Source severity: High (P1)

Overlap group: B-09

Current code: confirmed

Root cause: Boot DDL already removed; missing image migrations; root nullable-task drift; production allowed postgres.

Action and residual scope: Ship/gate migrations; restore nullable reference; reject production admin role. Legacy history adoption and comprehensive schema equivalence still unverified. After reviewing all 18 source-credential matches, production URI validation rejects known public role defaults (including encoded/query forms) and query-user bypasses. Local database/Redis/mail host ports are loopback-only; runtime Docker/role behavior remains unverified. Fresh-local bootstrap now requires supplied credentials/acknowledgement and refuses existing roles/public objects/non-default schemas, while Compose requires coherent generated settings and a unique project. Existing installations require an approved backed-up forward/rotation plan; no automatic password changes or volume deletion. Owned fresh/repeated/populated/failed PostgreSQL fixtures and role/grant/DDL checks execute under C17/C32; actual Compose/images and deployed legacy rehearsal remain BLOCKED/NOT RUN.

Regression evidence: Role/startup/known-column guards plus actual owned PostgreSQL16 fresh/repeated/populated/intentional-failure/least-privilege probes execute in C17/C32. These are current-schema fixtures, not actual deployed legacy history, Docker/image deployment or restore; C18/C35 remain BLOCKED. Final raw evidence governs outcomes.

Disposition: partial

Affected / inspected files: backend/Dockerfile; docker-compose.yml; schema.sql; backend/src/config/env.ts; backend/tests/unit/production-db-defaults.test.ts; docs/remediation/secret-triage.md; docs/remediation/secret-triage.json; scripts/local-setup.mjs; scripts/local-stack.mjs; scripts/local-setup.test.mjs; scripts/ci-database-env.mjs; backend/src/infrastructure/database/postgres/init-roles.sql; docs/development/local-setup.md; .env.example; backend/.env.example; .gitignore

### B-10 — Non-atomic reset attempt counter

Source severity: Medium (P2)

Overlap group: B-10

Current code: already fixed

Root cause: INCR accounts guesses atomically; code deletion provides one winner.

Action and residual scope: Preserve algorithm; make OTP unit tests always in-memory and add expiry test.

Regression evidence: 8 OTP tests including expiry, invalid, consumed and parallel valid/invalid cases PASS using fake Redis.

Disposition: fixed_verified

Affected / inspected files: backend/src/core/security/otp-service.ts; backend/tests/unit/otp-service.test.ts

### B-11 — Worker is a stub / BullMQ absent

Source severity: Medium (P2)

Overlap group: B-11

Current code: already fixed

Root cause: BullMQ maintenance workers already exist. Failure listeners and shutdown ownership were incomplete.

Action and residual scope: Preserve worker; add sanitized failed/error events and fail initialization on schedule error; remove reset queue.

Regression evidence: Unit processors PASS, real worker startup/crash/shutdown BLOCKED. Memory limiter NODE_ENV branch remains.

Disposition: partial

Affected / inspected files: backend/src/worker.ts; backend/src/jobs/job-processors.ts; backend/src/container.ts

### B-12 — Reminders event-only / no dispatch or push

Source severity: Medium (P2)

Overlap group: B-12

Current code: confirmed

Root cause: Unified API and dispatcher exist; push always throws; stale processing leases and double attempt counts.

Action and residual scope: Use in_app for client event reminders; truthful unavailable push; recover/fence leases and correct retries. Provider integration NOT implemented.

Regression evidence: Retry boundary and SQL-generation tests PASS; real DB reclaim and device local notification tests BLOCKED.

Disposition: partial

Affected / inspected files: backend/src/worker.ts; backend/src/jobs/job-stores.pg.ts; backend/src/jobs/job-processors.ts; mobile-app/mobile/lib/features/calendar/data/calendar_repository.dart

### B-13 — Plain SMTP transport silently swallows failures

Source severity: Medium (P2)

Overlap group: B-13

Current code: confirmed

Root cause: Raw TCP did not follow SMTP replies/TLS/auth; queue payload also exposed codes and depended on worker.

Action and residual scope: Replace with Nodemailer behind same interface; TLS required in production, auth/timeouts, accepted-recipient check, sanitized rejection. SMTP now runs inside a bounded volatile in-process reset-request worker, not on the public response path; OTP is generated after dequeue and never persisted in a delivery queue.

Regression evidence: Injected SMTP success/reject/timeout/network boundary tests PASS; real SMTP/TLS delivery BLOCKED. Forgot request stays generic and records failure.

Disposition: code_unverified

Affected / inspected files: backend/src/infrastructure/external/email-sender.ts; backend/src/features/auth/auth.service.ts; backend/src/container.ts; backend/src/core/security/reset-request-dispatcher.ts; backend/tests/unit/reset-request-dispatcher.test.ts

### B-14 — Success-envelope documentation contradicts raw DTOs

Source severity: Medium (P2)

Overlap group: B-14

Current code: confirmed

Root cause: Controllers and mobile use named DTOs; docs claimed success/data wrapper universally.

Action and residual scope: Document existing v1 contracts rather than break all clients. Optional helper remains unused, not universal.

Regression evidence: Actual dashboard router DTO tests PASS; static per-operation documentation reconciliation only.

Disposition: code_unverified

Affected / inspected files: docs/api/conventions.md; docs/api/openapi.yaml; backend/src/core/http/envelope.ts

### B-15 — Forbidden-dependency guard misses Flutter manifest

Source severity: Medium (P2)

Overlap group: B-15

Current code: targeted guard and policy corrected

Root cause: Guard scanned the wrong Flutter path and conflated a server-upload prohibition with an existing local audio picker. Its ADR-008 storage label was inaccurate: the actual ADR-008 concerns UUID primary keys.

Action and residual scope: Corrected manifest paths. Owner explicitly clarified on 2026-10-15 that server uploads are forbidden to avoid leaks, while existing local audio selection remains allowed. Permit only reviewed mobile dependency/lock entries and existing audio-only consumer, not a global file_picker allowlist. Preserve production server multipart/blob dependency bans, fail closed on invalid policy and emit metadata-only diagnostics. No mobile feature removal, new permission, upload endpoint or native/network certification.

Regression evidence: C10 executes the real clarified guard. C31: 21 Node negative/source/actual-CLI fixture tests; server dependency/new consumer/broad picker/malformed policy cases fail as expected. C06 includes 13 real HTTP middleware regressions for non-JSON rejection, JSON acceptance and size limit. Native picker/playback/network observation remains BLOCKED; fixed_verified is scoped only to this guard/policy finding.

Disposition: fixed_verified

Affected / inspected files: scripts/check-forbidden.mjs; scripts/forbidden-allowlist.json; mobile-app/mobile/pubspec.yaml; scripts/check-forbidden.test.mjs; backend/tests/unit/upload-boundary.test.ts; docs/security/local-audio-boundary.md; docs/architecture/design-decisions.md; docs/architecture/deferred-and-non-goals.md

### B-16 — Coverage gaps

Source severity: Medium (P2)

Overlap group: B-16

Current code: confirmed

Root cause: Many domains and concurrency/limiters lack meaningful integration coverage. Typecheck originally excluded all tests.

Action and residual scope: Add targeted remediation tests and strict test-source compilation. Existing project/recurring/concurrent refresh/limiters coverage still incomplete. Replaced the disconnected logger test with actual production output capture; added limiter expiry/outage/atomic-call contracts and sensitive-route outage regressions. Added 39 authentication transaction/refresh/last-login units and two account-metadata export SQL-harness units; corrected transaction ownership in seven auth flows without changing reuse policy.

Regression evidence: Historical batch: 280 backend tests / 27 files PASS; final C06/report govern current totals; source+test strict compilation PASS. An initial 18-test transaction probe failed 10 cases before the fix; final 39 transaction/last-login tests and 2 metadata-export tests PASS. Owned PostgreSQL/Redis integration/security now executes under C15/C16/C32; this does not certify every concurrency scenario. Flutter/native execution remains BLOCKED. Added 26 production URI-default regressions; 17 separate Node helper/provenance/source tests PASS in C26 (not included in backend count).

Disposition: partial

Affected / inspected files: backend/tests/unit/remediation-regressions.test.ts; backend/tsconfig.verification.json; mobile-app/mobile/test/digital_detox_test.dart; backend/tests/unit/logger-redaction.test.ts; backend/tests/unit/rate-limiter.test.ts; backend/tests/unit/sensitive-actions.test.ts; mobile-app/mobile/test/account_export_dialog_test.dart; backend/tests/unit/auth-transactions.test.ts; backend/tests/unit/account-export.test.ts; backend/src/features/auth/auth.service.ts; backend/src/features/auth/auth.repository.ts; backend/src/features/auth/auth.repository.pg.ts; backend/tests/unit/production-db-defaults.test.ts; scripts/check-environment.test.mjs

### B-17 — Destructive tests target development DB and Redis

Source severity: Medium (P2)

Overlap group: B-17

Current code: confirmed

Root cause: Setup overwrote endpoints with lifestyle_dev/Redis0. OTP unit test also opportunistically contacted Redis.

Action and residual scope: Require explicit acknowledgement + lifestyle_test DB + nonzero Redis DB before importing integration/security files; inert unit endpoints and in-memory OTP. CI ephemeral services. Every integration/security suite has a first-import guard, protecting direct runner invocations too. Replaced unsafe legacy helper setup/down-up defaults: configuration-only ensure-env, unit-only verify-ci default, explicit isolated guards for matching application/migration targets and nonzero Redis, forward-up/repeat only, propagated errors. CI services are declared disposable, not verified live here. Added a separate GitHub-hosted disposable runtime workflow, local-socket service identity/network/port preflight before bootstrap, repeat-bootstrap refusal check and independent forward/integration/security gates. The existing policy gate is unchanged; actual hosted execution NOT RUN.

Regression evidence: Guard accept/refuse unit tests PASS; actual unsafe integration invocation rejected before test import. Actual destructive hooks execute only after C32 proves fresh owned process/data-directory/DB identity; no existing user service is used or cleaned. C26: 17 standalone configuration/command-spy/provenance/Compose source tests PASS; simulated commands are not actual migration or isolation proof.

Disposition: fixed_verified

Affected / inspected files: backend/tests/setup.ts; backend/tests/test-safety.ts; backend/tests/unit/otp-service.test.ts; .github/workflows/ci.yml; backend/tests/infrastructure-safety.ts; scripts/ensure-env.sh; scripts/verify-ci.sh; scripts/check-environment.mjs; scripts/check-environment.test.mjs; .github/workflows/isolated-runtime.yml; scripts/ci-resource-guard.mjs; scripts/ci-resource-guard.test.mjs

### B-18 — Export/deletion lack reauthentication

Source severity: Medium (P2)

Overlap group: B-18

Current code: partially remediated

Root cause: Sensitive authenticated actions lacked proof. The reused general Redis limiter failed open on outage; export UI automatically copied private data. Legacy export was unbounded/materialized and metadata-only despite complete/GDPR wording, and fetched unused password hashes. New bounded archive/mobile source does not prove end-to-end delivery.

Action and residual scope: Required current-password proof with shared 5 attempts/15-minute budget and opt-in fail-closed 503 on limiter outage; Cache-Control no-store on user responses. Updated client prompts and contracts. Removed automatic clipboard copy; explicit warning/acknowledgement/action UI added (Flutter unverified). Disclosed metadata-only scope in UI/OpenAPI; selected only required profile columns; controlled 404 if the account disappears. Added a separate streamed version-1 domain archive across 21 explicit sections with excluded security/infrastructure fields, repeatable-read read-only cursor snapshot, decimal-string amounts, byte/row/time/concurrency limits, cancellation/backpressure and validated completion footer. Legacy metadata responses remain compatible below an explicit 1000-row-per-list limit; overflow fails 413, never silent truncation. Added Android source for incremental exact-byte validation, encrypted private staging and explicit SAF plaintext-destination save/readback with cancellation/owned cleanup and no new permissions. Large-account/other-platform adapters, Flutter/Android bridge compilation and deployed PostgreSQL/proxy/provider/device verification remain incomplete; retention unchanged; local-only audio policy clarified separately under B-15, without authorizing server uploads.

Regression evidence: Six real-router proof/no-store units, logger-redaction and nine limiter units execute within C06. Prior 280-test/27-file batch is historical; final C06/evidence and generated report govern the current backend count (323/29 at this update). Password and legacy clipboard widget tests remain authored NOT RUN. Metadata projection/owner/missing-account/overflow and archive SQL/HTTP/control-flow units execute without a live DB; live snapshot/grants/tenancy/grace-period HTTP cases now execute in owned PostgreSQL/Redis C15/C32; deployment/native gates remain BLOCKED. C29: 8 synthetic fixture/source checks, NOT Dart runtime. C30: 10 actual Android-free JVM staging/crypto checks, including EOF-time revocation, NOT Android bridge/provider execution. 25 new archive Flutter protocol/coordinator/transport/widget cases authored NOT RUN. C12 parsed 34 changed Dart files, syntax only. No end-to-end portability/release claim.

Disposition: partial

Affected / inspected files: backend/src/features/users/users.controller.ts; backend/src/features/users/users.service.ts; mobile-app/mobile/lib/features/auth/data/auth_repository.dart; backend/src/features/users/users.validation.ts; backend/src/features/users/users.routes.ts; backend/tests/unit/sensitive-actions.test.ts; mobile-app/mobile/lib/features/auth/state/auth_provider.dart; mobile-app/mobile/lib/features/auth/presentation/profile_screen.dart; docs/remediation/sensitive-actions.md; mobile-app/mobile/lib/features/auth/presentation/current_password_dialog.dart; mobile-app/mobile/test/current_password_dialog_test.dart; mobile-app/mobile/lib/l10n/app_localizations.dart; mobile-app/mobile/lib/l10n/catalog_en.dart; backend/src/core/middleware/rate-limiter.ts; backend/src/core/logger/logger.ts; backend/tests/unit/logger-redaction.test.ts; backend/tests/unit/rate-limiter.test.ts; mobile-app/mobile/lib/features/auth/presentation/account_export_dialog.dart; mobile-app/mobile/test/account_export_dialog_test.dart; docs/remediation/follow-up-hardening.md; backend/src/features/users/users.repository.pg.ts; backend/tests/unit/account-export.test.ts; backend/src/features/users/account-archive.ts; backend/src/features/users/account-archive.sources.ts; backend/tests/unit/account-archive.test.ts; backend/tests/integration/account-archive.test.ts; backend/src/core/middleware/authenticate.ts; docs/api/account-archive.md; mobile-app/mobile/lib/data/api_client.dart; mobile-app/mobile/lib/core/archive/archive_verifier.dart; mobile-app/mobile/lib/core/archive/archive_cancellation.dart; mobile-app/mobile/lib/core/archive/archive_export.dart; mobile-app/mobile/lib/features/auth/presentation/account_archive_dialog.dart; mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/AccountArchiveStage.kt; mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/AccountArchiveBridge.kt; mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/MainActivity.kt; mobile-app/mobile/pubspec.yaml; mobile-app/mobile/pubspec.lock; mobile-app/mobile/test/account_archive_test.dart; mobile-app/mobile/test/account_archive_transport_test.dart; mobile-app/mobile/test/account_archive_dialog_test.dart; mobile-app/mobile/test/fixtures/account_archive_v1.ndjson; scripts/archive-mobile-contract.test.mjs; scripts/check-archive-stage.py; scripts/kotlin/AccountArchiveStageHarness.kt; docs/mobile/account-archive.md

### B-19 — Timer sessions without task versus documented requirement

Source severity: Medium (P2)

Overlap group: B-09

Current code: confirmed

Root cause: ADR-044 allows optional task; stale schema/tasks docs required task_id.

Action and residual scope: Preserve approved optional behavior, align reference schema/docs.

Regression evidence: Known-column static unit guard PASS; actual constraints/migration BLOCKED.

Disposition: code_unverified

Affected / inspected files: schema.sql; docs/architecture/tasks.md; backend/src/infrastructure/database/postgres/migrations/1727300004000_timer_sessions_optional_task.cjs

### B-20 — Documentation overstates/nonexistent controls and features

Source severity: Medium (P2)

Overlap group: B-20

Current code: confirmed

Root cause: Conventions, locale count, AI key mirroring and timer docs stale; broad historic docs still need review.

Action and residual scope: Correct focused contracts/storage/locale/timer docs and add runbooks; no claim all historic documents reconciled. Removed complete/GDPR export claims from live contract/UI; marked two prior P2 reports historical and non-authoritative for current gates. Documented per-match credential triage, helper compatibility changes and loopback-only infrastructure; marked old P3/P5 helper verification assertions historical.

Regression evidence: Focused static reconciliation; documentation inventory not a runtime PASS.

Disposition: partial

Affected / inspected files: docs/api/conventions.md; docs/mobile/flutter-integration.md; docs/architecture/deferred-and-non-goals.md; docs/database/migrations.md; docs/security/p2-security-review.md; docs/reports/phase-p2-delivery-report.md; docs/remediation/session-and-scanner-hardening.md; docs/security/p3-security-review.md; docs/reports/phase-p5-delivery-report.md; docs/remediation/secret-triage.md; docs/remediation/secret-triage.json; docs/development/testing.md

### B-21 — Search coverage incomplete

Source severity: Medium (P2)

Overlap group: B-21

Current code: confirmed

Root cause: Search covers five readers; no goals/subscriptions/transactions. MoneyReader explicitly disallows full transaction-list exposure. LIKE metacharacters unescaped.

Action and residual scope: Escape wildcard input across five readers. Coverage expansion still open pending approved result contract/privacy reconciliation.

Regression evidence: Literal wildcard unit PASS; cross-user HTTP and index plans BLOCKED.

Disposition: partial

Affected / inspected files: backend/src/features/search/search.service.ts; backend/src/core/pagination/search-pattern.ts; backend/src/features/notes/notes.reader.ts

### B-22 — Auxiliary listeners not closed on shutdown

Source severity: Low (P3)

Overlap group: B-22

Current code: already fixed

Root cause: server.ts tracks and closes auxiliary servers.

Action and residual scope: Preserve prior fix.

Regression evidence: Static inspection only; process shutdown test NOT RUN.

Disposition: code_unverified

Affected / inspected files: backend/src/server.ts

### B-23 — Demo HTML embedded in app.ts

Source severity: Low (P3)

Overlap group: B-23

Current code: already fixed

Root cause: Demo moved to demo module and gated away from production.

Action and residual scope: Preserve prior fix.

Regression evidence: Static inspection only; production deployment NOT RUN.

Disposition: code_unverified

Affected / inspected files: backend/src/app.ts; backend/src/demo/live-preview-page.ts

### B-24 — Unsafe casts and services accessing DB

Source severity: Low (P3)

Overlap group: B-24

Current code: confirmed

Root cause: Layering/casts remain widespread; tests previously excluded from strict compilation.

Action and residual scope: No mass refactor. Add strict source+test typecheck, fix focused test narrowing errors, retain unrelated architecture.

Regression evidence: Strict test and source compilation PASS; casts/service DB boundaries still open.

Disposition: partial

Affected / inspected files: backend/tsconfig.verification.json; backend/tests/unit/ingest-analyze.test.ts; backend/tests/integration/ingest-analyze-flow.test.ts

### B-25 — Rate-limit values differ from specification

Source severity: Low (P3)

Overlap group: B-25

Current code: unclear

Root cause: Current routes have explicit IP/account limits; latest report does not supply required alternative values; earlier audit unavailable.

Action and residual scope: Do not invent policy values. Obtain original expected thresholds before changing security policy.

Regression evidence: Limiters inspected; exact-spec comparison BLOCKED by absent original description.

Disposition: unclear

Affected / inspected files: backend/src/features/auth/auth.routes.ts

### B-26 — Weak password denylist / unvalidated timezone/currency

Source severity: Low (P3)

Overlap group: B-26

Current code: confirmed

Root cause: Denylist has eight entries; registration/profile timezone unchecked and any 3 uppercase currency accepted.

Action and residual scope: Reject blank passwords; validate IANA timezone and ICU ISO currencies across registration/profile/money. Broader denylist policy remains open.

Regression evidence: Invalid timezone/currency/blank-password tests PASS; denylist breadth not fixed.

Disposition: partial

Affected / inspected files: backend/src/core/security/profile-validation.ts; backend/src/features/auth/auth.validation.ts; backend/src/features/users/users.validation.ts; backend/src/features/money/money.validation.ts

### B-27 — Forgot/reset password timing differential

Source severity: Low (P3)

Overlap group: B-27

Current code: confirmed

Root cause: Historical direct account/cooldown/SMTP branches held the public request open; invalid-reset expensive-operation parity also differed.

Action and residual scope: Retained invalid-reset dummy-comparison parity. Forgot-password now admits bounded volatile work before account lookup/cooldown/OTP/SMTP, with generic 202 and account-independent full/draining 503. Per-process singleton limits 64 outstanding/four workers/60-second queue wait. Email and capped metadata only; no OTP/password queued, no durable-delivery assertion or fake delay. Worker errors/expiry are sanitized; SMTP failure remains audited. Detached HTTP context; stop admission and drain before infrastructure close, with explicit 30-second forced-loss diagnostics. OpenAPI corrected to actual 202/503 semantics. Aggregate-load/statistical timing, actual process-signal shutdown and live-provider verification remain unverified; no constant-time claim. The new integration correlation assertion exposed existing extractMeta reading req.requestId instead of middleware req.id; corrected that field, retained the assertion and raw first failure. All six mobile reset-request messages now use conditional best-effort wording instead of asserting that a code was sent.

Regression evidence: C06 includes 17 new admission/bounds/expiry/projection/context/drain/service/HTTP tests plus retained three invalid-reset parity tests. Stalled lookup/cooldown/SMTP cannot hold HTTP 202 open. C15 auth integration drains background work and asserts HMAC-only Redis state and correlated audit with no secret metadata. These are targeted disposable/mocked-boundary tests, not live provider/statistical enumeration-resistance or actual process-signal certification; final checks.json/evidence governs results.

Disposition: partial

Affected / inspected files: backend/src/features/auth/auth.service.ts; backend/tests/unit/auth-transactions.test.ts; docs/remediation/runtime-and-cleanup.md; backend/src/core/security/reset-request-dispatcher.ts; backend/src/server.ts; backend/src/container.ts; backend/src/docs/openapi-generator.ts; docs/api/openapi.yaml; backend/tests/unit/reset-request-dispatcher.test.ts; backend/tests/unit/remediation-regressions.test.ts; backend/tests/integration/auth-flow.test.ts; backend/src/features/auth/auth.controller.ts; mobile-app/mobile/lib/l10n/catalog_en.dart; mobile-app/mobile/lib/l10n/catalog_ar.dart; mobile-app/mobile/lib/l10n/catalog_fr.dart; mobile-app/mobile/lib/l10n/catalog_es.dart; mobile-app/mobile/lib/l10n/catalog_de.dart; mobile-app/mobile/lib/l10n/catalog_tr.dart

### B-28 — Configured refresh/session TTLs ignored

Source severity: Low (P3)

Overlap group: B-28

Current code: confirmed

Root cause: AuthService used literal 90/30 days in registration/login/refresh.

Action and residual scope: Use validated SESSION_ABSOLUTE_TTL_DAYS and REFRESH_TOKEN_TTL_DAYS; preserve absolute cap.

Regression evidence: Registration nondefault TTL test PASS; source review confirms same configured values in login/refresh.

Disposition: fixed_verified

Affected / inspected files: backend/src/features/auth/auth.service.ts; backend/tests/unit/remediation-regressions.test.ts

### B-29 — Non-strict schemas / extra transaction fields

Source severity: Low (P3)

Overlap group: B-29

Current code: confirmed

Root cause: Money/calendar Zod objects stripped unknown fields; subscriptionId/billingDate are still explicit accepted fields used by callers.

Action and residual scope: Make reported object schemas strict. Do not remove explicit linked-transaction fields without original spec/caller decision.

Regression evidence: Extra transaction key rejection PASS; policy for explicit extra fields remains unclear.

Disposition: partial

Affected / inspected files: backend/src/features/money/money.validation.ts; backend/src/features/calendar/calendar.validation.ts

### B-30 — Debug signing fallback / no obfuscation / lock-screen display

Source severity: Low (P3)

Overlap group: B-30

Current code: confirmed

Root cause: Release fell back to debug signing; main activity exposed showWhenLocked/turnScreenOn; Dart obfuscation absent.

Action and residual scope: Removed debug release fallback and main-activity lock-screen overrides. Release preReleaseBuild now depends on complete signing properties/readable keystore; release selects only release identity. Corrected plugins-block ordering, explicitly applied Kotlin to match existing AGP9 opt-out and selected Java17 in CI. Automatic CI explicitly builds/signature-checks a debug validation APK with offline-by-default endpoint and honest name; approved HTTPS test backend can be explicitly supplied manually. Separate manual-main signed build requires both quality gates, private environment keys and expected public certificate, uses obfuscation/separate symbols, disables cache export and cleans only owned signing files. APK verifier requires actual SDK signature success, one expected non-debug signer before release upload. Workflow authored only; actual Gradle/obfuscation/APK/signature/device execution remains BLOCKED/NOT RUN, so no verified release is asserted.

Regression evidence: C37 runs 13 real filesystem/negative/certificate-parser/CLI-refusal/source/YAML/bash-syntax checks. Synthetic bytes/certificate output are not real keys/signatures. C19-C22 remain BLOCKED and hosted CI C24 NOT RUN; actual release compilation/identity/obfuscation extraction and physical-device checks still required.

Disposition: partial

Affected / inspected files: mobile-app/mobile/android/app/build.gradle.kts; mobile-app/mobile/android/app/src/main/AndroidManifest.xml; .github/workflows/ci.yml; .gitignore; scripts/prepare-android-signing.mjs; scripts/verify-android-apk.mjs; scripts/android-build-preparation.test.mjs; docs/mobile/build-preparation.md

### B-31 — CI scanning and DB timeout gaps

Source severity: Low (P3)

Overlap group: B-31

Current code: partial implementation; actual current-source scan PASS; historical detector FAIL with reviewed local-default provenance; hosted/image execution NOT RUN

Root cause: No image/secret scanners; pool lacked statement timeout.

Action and residual scope: Retained 15s statement_timeout; pinned isolated Secretlint and metadata-only Git worktree scanning, independent CI workflow, parseable short-Ed25519 coverage and real positive/negative probes. No detector exceptions. Retained all 18 historical match records and the earlier 18/16 FAIL history. Removed two unsafe helper defaults, then replaced remaining tracked application defaults with independent per-installation local/per-job CI credentials and matching bootstrap/Compose wiring. Fresh-only private files, exclusive creation, namespace/socket pinning and existing-config/role refusal; no overwrite, deletion or automatic rotation. CI public ephemeral administrator fixture remains. Current-source scan reports zero findings; deployed reuse is unknown; Owned PostgreSQL runtime executes under C32; Docker/hosted/container verification remains unexecuted. Historical detection/provenance now executes separately in C36/C38. Added a separate GitHub-hosted disposable runtime workflow, local-socket service identity/network/port preflight before bootstrap, repeat-bootstrap refusal check and independent forward/integration/security gates. The existing policy gate is unchanged; actual hosted execution NOT RUN.

Regression evidence: C25 actual current-source detector/probes, C26 17 helper/provenance tests, C27 22 fresh-config tests and C28 16 hosted-resource command-spy tests are separate scoped gates; see final checks.json for fresh outcomes. C32 actually runs owned PostgreSQL/Redis migrations/integration/security, not Docker or deployed resources. Previous shallow C36 result (459 blobs/one commit/11 URI matches) is preserved in history. After actual unshallow fetch, C36 scans 1,033 UTF-8 blobs/93 reachable commits: 37 URI matches/eight skips, FAIL. C38 exact in-memory comparison identifies all 37 as baseline repository development-role defaults at local service hosts, with negative controls and metadata-only output: provenance PASS, deployed reuse BLOCKED. No rewrite/suppression/live rotation. Original 18 source records retained; CI edits append reasoned fingerprint chains. Images/hosted CI NOT RUN.

Disposition: partial

Affected / inspected files: backend/src/infrastructure/database/postgres/pool.ts; .github/workflows/ci.yml; tools/security/package.json; tools/security/package-lock.json; tools/security/.secretlintrc.json; tools/security/.secretlintignore; tools/security/rules/parseable-private-key.mjs; scripts/scan-secrets.mjs; .github/workflows/security.yml; docs/remediation/session-and-scanner-hardening.md; docs/remediation/secret-triage.md; docs/remediation/secret-triage.json; backend/tests/unit/production-db-defaults.test.ts; scripts/check-environment.mjs; scripts/check-environment.test.mjs; scripts/ensure-env.sh; scripts/verify-ci.sh; docker-compose.yml; docker/docker-compose.yml; scripts/local-setup.mjs; scripts/local-stack.mjs; scripts/local-setup.test.mjs; scripts/ci-database-env.mjs; backend/src/infrastructure/database/postgres/init-roles.sql; docs/development/local-setup.md; .env.example; backend/.env.example; .gitignore; .github/workflows/isolated-runtime.yml; scripts/ci-resource-guard.mjs; scripts/ci-resource-guard.test.mjs; scripts/scan-git-history.py; docs/remediation/history-scan.json; scripts/review-history-provenance.py; docs/remediation/history-provenance.json

### B-32 — Repository hygiene

Source severity: Low (P3)

Overlap group: B-32

Current code: partial cleanup

Root cause: Duplicate Dockerfile text copies, duplicate compose and generated registrant tracked.

Action and residual scope: Deleted audited root Dockerfile.txt and Dockerfile (1).txt duplicates, removed generated plugin registrant and added its Flutter ignore rule; added unreleased CHANGELOG. Canonical backend/docker Dockerfiles and compose compatibility paths retained deliberately. Broader dead/duplicate voice code and release-policy cleanup remain.

Regression evidence: Reference search found no consumers of deleted Dockerfile text copies; diff/package deletion inventory checked. Flutter regeneration/native build BLOCKED. C34 strict unused-local/parameter TypeScript check PASS, no backend candidates invented. Removed proven dead native provider/recording scaffolding; C33 eight source checks only, not native execution.

Disposition: partial

Affected / inspected files: Dockerfile.txt; Dockerfile (1).txt; docker/docker-compose.yml; mobile-app/mobile/android/app/src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java; mobile-app/mobile/.gitignore; CHANGELOG.md

### B-33 — Client budget monetary arithmetic uses double

Source severity: Low (P3)

Overlap group: B-33

Current code: code changed; runtime unverified

Root cause: Mobile overview used double and aggregated unrelated currencies and subscription periods.

Action and residual scope: Introduced four-place BigInt DecimalAmount, integer HALF_UP currency formatting, exact +/- totals, per-currency budget/subscription cards and exports. Active subscriptions use server monthlyEquivalent. Only bounded dimensionless progress uses double. No ledger records rewritten.

Regression evidence: Five pure money regressions authored for 0.1+0.2, large values, JPY/KWD/CLF/negative ties, currency separation and input/progress; NOT RUN because Flutter/Dart SDK absent. WASM syntax parse PASS only.

Disposition: code_unverified

Affected / inspected files: mobile-app/mobile/lib/features/money/presentation/money_screen.dart; mobile-app/mobile/lib/core/money/decimal_amount.dart; mobile-app/mobile/test/decimal_amount_test.dart

### R-01 — Mobile Daily Plan requests unregistered dashboard root

Source severity: High

Overlap group: B-06

Current code: confirmed

Root cause: Backend readers exist; client calls nonexistent dashboard root; minor-unit summaries used Number*100.

Action and residual scope: Actual router success/401/failure and static client/OpenAPI path contract PASS; no device runtime claim.

Regression evidence: Actual router success/401/failure and static client/OpenAPI path contract PASS; no device runtime claim.

Disposition: fixed_verified

Affected / inspected files: backend/src/features/dashboard/dashboard.service.ts; backend/src/features/money/money.reader.ts; mobile-app/mobile/lib/features/more/data/daily_plan_models.dart

### R-02 — Reusable plaintext reset code in BullMQ payload

Source severity: Medium

Overlap group: B-13

Current code: confirmed

Root cause: Raw TCP did not follow SMTP replies/TLS/auth; queue payload also exposed codes and depended on worker.

Action and residual scope: Producer/payload/worker reset consumer removed. Secret remains only in memory and hashed OTP state; source boundary regression PASS.

Regression evidence: Producer/payload/worker reset consumer removed. Secret remains only in memory and hashed OTP state; source boundary regression PASS.

Disposition: fixed_verified

Affected / inspected files: backend/src/infrastructure/external/email-sender.ts; backend/src/features/auth/auth.service.ts; backend/src/container.ts

### R-03 — SMTP failures resolve, defeating retries

Source severity: Medium

Overlap group: B-13

Current code: confirmed

Root cause: Raw TCP did not follow SMTP replies/TLS/auth; queue payload also exposed codes and depended on worker.

Action and residual scope: SMTP boundary rejects/sanitizes and tests PASS; actual TLS/provider delivery BLOCKED.

Regression evidence: SMTP boundary rejects/sanitizes and tests PASS; actual TLS/provider delivery BLOCKED.

Disposition: code_unverified

Affected / inspected files: backend/src/infrastructure/external/email-sender.ts; backend/src/features/auth/auth.service.ts; backend/src/container.ts

### R-04 — Push sender stub while mobile requests push

Source severity: Medium

Overlap group: B-12

Current code: confirmed

Root cause: Unified API and dispatcher exist; push always throws; stale processing leases and double attempt counts.

Action and residual scope: Mobile uses in_app plus existing local notifications; push explicitly unavailable, not implemented. Device delivery BLOCKED.

Regression evidence: Mobile uses in_app plus existing local notifications; push explicitly unavailable, not implemented. Device delivery BLOCKED.

Disposition: partial

Affected / inspected files: backend/src/worker.ts; backend/src/jobs/job-stores.pg.ts; backend/src/jobs/job-processors.ts; mobile-app/mobile/lib/features/calendar/data/calendar_repository.dart

### R-05 — Applied migration edited; existing installs miss DELETE grant

Source severity: Medium

Overlap group: B-07

Current code: confirmed

Root cause: Worker scheduling exists; duplicate account purge, missing upgrade grant, silent soft purge errors; audit/session retention absent.

Action and residual scope: Original ingest grant restored; forward-only grant repair plus manual upgrade correction. PostgreSQL upgrade/grant verification BLOCKED.

Regression evidence: Original ingest grant restored; forward-only grant repair plus manual upgrade correction. PostgreSQL upgrade/grant verification BLOCKED.

Disposition: code_unverified

Affected / inspected files: backend/src/jobs/job-stores.pg.ts; backend/src/features/users/users.repository.pg.ts; backend/src/infrastructure/database/postgres/migrations/1792022400000_ingest_delete_grant.cjs

### R-06 — Processing reminders never recovered after crash

Source severity: Medium

Overlap group: B-12

Current code: confirmed

Root cause: Unified API and dispatcher exist; push always throws; stale processing leases and double attempt counts.

Action and residual scope: 10-minute claim lease, max-five terminal handling and attempt fences added. SQL-generation PASS; real DB crash/reclaim test added but BLOCKED.

Regression evidence: 10-minute claim lease, max-five terminal handling and attempt fences added. SQL-generation PASS; real DB crash/reclaim test added but BLOCKED.

Disposition: code_unverified

Affected / inspected files: backend/src/worker.ts; backend/src/jobs/job-stores.pg.ts; backend/src/jobs/job-processors.ts; mobile-app/mobile/lib/features/calendar/data/calendar_repository.dart

### R-07 — Floating point and fixed two-decimal dashboard/day money

Source severity: Medium

Overlap group: B-06

Current code: confirmed

Root cause: Backend readers exist; client calls nonexistent dashboard root; minor-unit summaries used Number*100.

Action and residual scope: Exact Decimal HALF_UP integer strings; exponents in client BigInt formatter. USD/JPY/KWD/boundary unit tests PASS; Flutter/DB contract runtime BLOCKED.

Regression evidence: Exact Decimal HALF_UP integer strings; exponents in client BigInt formatter. USD/JPY/KWD/boundary unit tests PASS; Flutter/DB contract runtime BLOCKED.

Disposition: code_unverified

Affected / inspected files: backend/src/features/dashboard/dashboard.service.ts; backend/src/features/money/money.reader.ts; mobile-app/mobile/lib/features/more/data/daily_plan_models.dart

### R-08 — Ingest credential/SMS queues plaintext and backed up

Source severity: Medium

Overlap group: B-01

Current code: confirmed

Root cause: Access/refresh already in secure storage. Ingest token and SMS queues still used preferences.

Action and residual scope: Credential encrypted with device-bound Keystore; legacy migration and backup exclusions added. Native tests BLOCKED; SMS queues remain plaintext.

Regression evidence: Credential encrypted with device-bound Keystore; legacy migration and backup exclusions added. Native tests BLOCKED; SMS queues remain plaintext.

Disposition: partial

Affected / inspected files: mobile-app/mobile/lib/data/token_store.dart; mobile-app/mobile/lib/features/money/data/wallet_ingest_token.dart; mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/WalletCredentialStore.kt; mobile-app/mobile/android/app/src/main/AndroidManifest.xml

### R-09 — Reset delivery requires live worker consumer

Source severity: Medium

Overlap group: B-13

Current code: confirmed

Root cause: Raw TCP did not follow SMTP replies/TLS/auth; queue payload also exposed codes and depended on worker.

Action and residual scope: API uses direct SMTP sender independent of NODE_ENV/worker. Worker remains required for maintenance, not reset delivery. Boundary tests PASS.

Regression evidence: API uses direct SMTP sender independent of NODE_ENV/worker. Worker remains required for maintenance, not reset delivery. Boundary tests PASS.

Disposition: fixed_verified

Affected / inspected files: backend/src/infrastructure/external/email-sender.ts; backend/src/features/auth/auth.service.ts; backend/src/container.ts

### R-10 — Fresh containers lack schema-creation deployment step

Source severity: Medium

Overlap group: B-09

Current code: confirmed

Root cause: Boot DDL already removed; missing image migrations; root nullable-task drift; production allowed postgres.

Action and residual scope: Images ship migrations; Compose one-shot gates API/worker. Fresh/repeat/populated/failed owned PostgreSQL fixture runtime executes in C32; actual image deployment remains BLOCKED; legacy baseline not automated. Fresh-local bootstrap now requires supplied credentials/acknowledgement and refuses existing roles/public objects/non-default schemas, while Compose requires coherent generated settings and a unique project. Existing installations require an approved backed-up forward/rotation plan; no automatic password changes or volume deletion. Owned fresh/repeated/populated/failed PostgreSQL fixtures and role/grant/DDL checks execute under C17/C32; actual Compose/images and deployed legacy rehearsal remain BLOCKED/NOT RUN.

Regression evidence: Role/startup/known-column guards plus actual owned PostgreSQL16 fresh/repeated/populated/intentional-failure/least-privilege probes execute in C17/C32. These are current-schema fixtures, not actual deployed legacy history, Docker/image deployment or restore; C18/C35 remain BLOCKED. Final raw evidence governs outcomes.

Disposition: code_unverified

Affected / inspected files: backend/Dockerfile; docker-compose.yml; schema.sql; backend/src/config/env.ts; scripts/local-setup.mjs; scripts/local-stack.mjs; scripts/local-setup.test.mjs; scripts/ci-database-env.mjs; backend/src/infrastructure/database/postgres/init-roles.sql; docs/development/local-setup.md; .env.example; backend/.env.example; .gitignore

### R-11 — Duplicate account purge; production copy untested

Source severity: Low

Overlap group: B-07

Current code: confirmed

Root cause: Worker scheduling exists; duplicate account purge, missing upgrade grant, silent soft purge errors; audit/session retention absent.

Action and residual scope: Job store delegates to single UsersRepository purge implementation. Existing unit tests PASS; populated production-path integration test still BLOCKED.

Regression evidence: Job store delegates to single UsersRepository purge implementation. Existing unit tests PASS; populated production-path integration test still BLOCKED.

Disposition: code_unverified

Affected / inspected files: backend/src/jobs/job-stores.pg.ts; backend/src/features/users/users.repository.pg.ts; backend/src/infrastructure/database/postgres/migrations/1792022400000_ingest_delete_grant.cjs

### R-12 — Soft-delete purge catches all errors silently

Source severity: Low

Overlap group: B-07

Current code: confirmed

Root cause: Worker scheduling exists; duplicate account purge, missing upgrade grant, silent soft purge errors; audit/session retention absent.

Action and residual scope: Remove catch-all; permission/constraint/connection errors propagate to observable failed worker event. Failure-injection unit PASS.

Regression evidence: Remove catch-all; permission/constraint/connection errors propagate to observable failed worker event. Failure-injection unit PASS.

Disposition: fixed_verified

Affected / inspected files: backend/src/jobs/job-stores.pg.ts; backend/src/features/users/users.repository.pg.ts; backend/src/infrastructure/database/postgres/migrations/1792022400000_ingest_delete_grant.cjs

### R-13 — Day endpoint accepts impossible dates

Source severity: Low

Overlap group: R-13

Current code: confirmed

Root cause: Day endpoint accepts impossible dates

Action and residual scope: Zod real-date and 1900–9999 range validation. Leap-day and impossible-date units PASS.

Regression evidence: Zod real-date and 1900–9999 range validation. Leap-day and impossible-date units PASS.

Disposition: fixed_verified

Affected / inspected files: backend/src/features/days/days.validation.ts

### R-14 — Search LIKE metacharacters treated as patterns; note body unindexed

Source severity: Low

Overlap group: B-21

Current code: confirmed

Root cause: Search covers five readers; no goals/subscriptions/transactions. MoneyReader explicitly disallows full transaction-list exposure. LIKE metacharacters unescaped.

Action and residual scope: Escape backslash/percent/underscore in five readers; literal pattern unit PASS. Trigram index/performance validation deferred pending DB plans.

Regression evidence: Escape backslash/percent/underscore in five readers; literal pattern unit PASS. Trigram index/performance validation deferred pending DB plans.

Disposition: partial

Affected / inspected files: backend/src/features/search/search.service.ts; backend/src/core/pagination/search-pattern.ts; backend/src/features/notes/notes.reader.ts

### R-15 — Worker errors unobservable and failed reset jobs discarded

Source severity: Low

Overlap group: B-11

Current code: confirmed

Root cause: BullMQ maintenance workers already exist. Failure listeners and shutdown ownership were incomplete.

Action and residual scope: Sanitized failed/error listeners; schedule registration failure closes worker/queue and exits nonzero. Reset queue removed. Worker runtime BLOCKED.

Regression evidence: Sanitized failed/error listeners; schedule registration failure closes worker/queue and exits nonzero. Reset queue removed. Worker runtime BLOCKED.

Disposition: code_unverified

Affected / inspected files: backend/src/worker.ts; backend/src/jobs/job-processors.ts; backend/src/container.ts

### R-16 — Reminder attempt counter incremented twice

Source severity: Low

Overlap group: B-12

Current code: confirmed

Root cause: Unified API and dispatcher exist; push always throws; stale processing leases and double attempt counts.

Action and residual scope: Claim is sole increment source; processor uses returned count. Fourth retry/fifth terminal boundary unit PASS.

Regression evidence: Claim is sole increment source; processor uses returned count. Fourth retry/fifth terminal boundary unit PASS.

Disposition: fixed_verified

Affected / inspected files: backend/src/worker.ts; backend/src/jobs/job-stores.pg.ts; backend/src/jobs/job-processors.ts; mobile-app/mobile/lib/features/calendar/data/calendar_repository.dart

### R-17 — Timer job closes at now, overstating tracked time

Source severity: Low

Overlap group: R-17

Current code: confirmed

Root cause: Timer job closes at now, overstating tracked time

Action and residual scope: Set ended_at = started_at + 12 hours. Generated SQL unit PASS; exact-duration real DB assertion added but BLOCKED.

Regression evidence: Set ended_at = started_at + 12 hours. Generated SQL unit PASS; exact-duration real DB assertion added but BLOCKED.

Disposition: code_unverified

Affected / inspected files: backend/src/jobs/job-stores.pg.ts

### R-18 — Table-only schema test misses nullable-task drift

Source severity: Low

Overlap group: B-09

Current code: confirmed

Root cause: Boot DDL already removed; missing image migrations; root nullable-task drift; production allowed postgres.

Action and residual scope: Nullable reference fixed; guard renamed as inventory-only and adds exact known-column check. Comprehensive schema-dump comparison still BLOCKED.

Regression evidence: Nullable reference fixed; guard renamed as inventory-only and adds exact known-column check. Comprehensive schema-dump comparison still BLOCKED.

Disposition: partial

Affected / inspected files: backend/Dockerfile; docker-compose.yml; schema.sql; backend/src/config/env.ts

### R-19 — Unclosed API queue connection; NODE_ENV selection

Source severity: Low

Overlap group: B-11

Current code: confirmed

Root cause: BullMQ maintenance workers already exist. Failure listeners and shutdown ownership were incomplete.

Action and residual scope: Remove API email queue and its connection entirely. Memory-vs-Redis limiter still selected by environment; not broadly refactored.

Regression evidence: Remove API email queue and its connection entirely. Memory-vs-Redis limiter still selected by environment; not broadly refactored.

Disposition: partial

Affected / inspected files: backend/src/worker.ts; backend/src/jobs/job-processors.ts; backend/src/container.ts

### R-20 — Reminder routes authenticate/rate-limit twice; cross-feature repositories

Source severity: Low

Overlap group: B-12

Current code: confirmed

Root cause: Unified API and dispatcher exist; push always throws; stale processing leases and double attempt counts.

Action and residual scope: Mount specific reminder routers first. Actual app authentication-count unit PASS; cross-feature repository coupling remains.

Regression evidence: Mount specific reminder routers first. Actual app authentication-count unit PASS; cross-feature repository coupling remains.

Disposition: partial

Affected / inspected files: backend/src/worker.ts; backend/src/jobs/job-stores.pg.ts; backend/src/jobs/job-processors.ts; mobile-app/mobile/lib/features/calendar/data/calendar_repository.dart

### R-21 — AI sends name/counts/typed text to third party

Source severity: Informational

Overlap group: R-21

Current code: confirmed

Root cause: AI sends name/counts/typed text to third party

Action and residual scope: Consent explanation before first outbound chat per screen instance. No promise of financial-text filtering. Flutter consent UI tests BLOCKED.

Regression evidence: Consent explanation before first outbound chat per screen instance. No promise of financial-text filtering. Flutter consent UI tests BLOCKED.

Disposition: code_unverified

Affected / inspected files: mobile-app/mobile/lib/features/ai/presentation/ai_assistant_screen.dart

### R-22 — Voice missing from ADR-044; dead Gemini transcription

Source severity: Informational

Overlap group: B-04

Current code: unclear

Root cause: ADR-044 records exceptions; server SMS key and BYOK guard remain. Voice not explicitly named.

Action and residual scope: Clarify actual platform recognition and unverified scope; do not invent authorization. Unreachable Gemini branch remains; device verification BLOCKED. 2026-10-16 cleanup removes both native dead Gemini upload/recording branches and misleading instant-alarm promises; retains existing OS speech channel/locale and compatibility notification entries. App-owned microphone/foreground-microphone capabilities removed; OS provider may use network. Original voice-scope approval remains unproven and native/device behavior BLOCKED.

Regression evidence: Clarify actual platform recognition and unverified scope; do not invent authorization. Unreachable Gemini branch remains; device verification BLOCKED. C33 eight source-contract checks PASS; no Android compile/device PASS inferred.

Disposition: unclear

Affected / inspected files: docs/architecture/design-decisions.md; mobile-app/mobile/lib/features/ai/data/ai_service.dart; mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/VoiceActionReceiver.kt; scripts/native-voice-cleanup.test.mjs; docs/remediation/runtime-and-cleanup.md

### R-23 — Offline dependency/build observations

Source severity: Informational

Overlap group: R-23

Current code: confirmed

Root cause: Offline dependency/build observations

Action and residual scope: npm lock install/build/audit execute; audit zero production vulnerabilities. Flutter override/plugin/build provenance still BLOCKED.

Regression evidence: npm lock install/build/audit execute; audit zero production vulnerabilities. Flutter override/plugin/build provenance still BLOCKED.

Disposition: partial

Affected / inspected files: backend/package.json; backend/package-lock.json; mobile-app/mobile/pubspec.yaml

## Per-file change inventory

Exact hashes and byte counts are in LifeStyle_App_Change_Manifest.md. Inventory includes unchanged-at-runtime evidence/runbook changes, not only application source.

### M: .env.example

Related scope: B-09, B-31, R-10. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: .github/workflows/ci.yml

Related scope: B-17, B-30, B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: .github/workflows/isolated-runtime.yml

Related scope: B-17, B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: .github/workflows/security.yml

Related scope: B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: .gitignore

Related scope: B-09, B-30, B-31, R-10. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: CHANGELOG.md

Related scope: B-32. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### D: Dockerfile (1).txt

Related scope: B-32. Remove specifically audited duplicate/generated artifact; regeneration/build remains unverified.

### D: Dockerfile.txt

Related scope: B-32. Remove specifically audited duplicate/generated artifact; regeneration/build remains unverified.

### M: backend/.env.example

Related scope: B-09, B-31, R-10. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/Dockerfile

Related scope: B-09, R-10, R-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/package-lock.json

Related scope: R-23. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: backend/package.json

Related scope: R-23. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: backend/src/app.ts

Related scope: B-23. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/config/env.ts

Related scope: B-09, R-10, R-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/container.ts

Related scope: B-11, B-13, B-27, R-02, R-03, R-09, R-15, R-19. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/core/errors/app-error.ts

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/core/logger/logger.ts

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/core/middleware/authenticate.ts

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/core/middleware/rate-limiter.ts

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: backend/src/core/pagination/search-pattern.ts

Related scope: B-21, R-14. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: backend/src/core/security/profile-validation.ts

Related scope: B-26. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: backend/src/core/security/reset-request-dispatcher.ts

Related scope: B-13, B-27. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/docs/openapi-generator.ts

Related scope: B-27. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/auth/auth.controller.ts

Related scope: B-27. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/auth/auth.repository.pg.ts

Related scope: B-16. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/auth/auth.repository.ts

Related scope: B-16. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/auth/auth.service.ts

Related scope: B-13, B-16, B-27, B-28, R-02, R-03, R-09. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/auth/auth.validation.ts

Related scope: B-26. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/calendar/calendar.reader.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/calendar/calendar.validation.ts

Related scope: B-29. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/dashboard/dashboard.service.ts

Related scope: B-06, R-01, R-07. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/dashboard/dashboard.types.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/days/days.validation.ts

Related scope: R-13. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/habits/habits.reader.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/money/money.dto.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/money/money.reader.ts

Related scope: B-06, R-01, R-07. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/money/money.validation.ts

Related scope: B-26, B-29. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/notes/notes.reader.ts

Related scope: B-21, R-14. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/projects/projects.reader.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/tasks/tasks.reader.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: backend/src/features/users/account-archive.sources.ts

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: backend/src/features/users/account-archive.ts

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/users/users.controller.ts

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/users/users.repository.pg.ts

Related scope: B-07, B-18, R-05, R-11, R-12. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/users/users.repository.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/users/users.routes.ts

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/users/users.service.ts

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/features/users/users.validation.ts

Related scope: B-18, B-26. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/infrastructure/database/postgres/init-roles.sql

Related scope: B-09, B-31, R-10. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/infrastructure/database/postgres/migrations/1727300003000_ingest_tokens.cjs

Related scope: B-09 / R-10 / R-18 / B-32. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: backend/src/infrastructure/database/postgres/migrations/1792022400000_ingest_delete_grant.cjs

Related scope: B-07, R-05, R-11, R-12. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/infrastructure/database/postgres/pool.ts

Related scope: B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/infrastructure/external/email-sender.ts

Related scope: B-13, R-02, R-03, R-09. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### D: backend/src/jobs/email-queue.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Remove specifically audited duplicate/generated artifact; regeneration/build remains unverified.

### M: backend/src/jobs/job-processors.ts

Related scope: B-11, B-12, R-04, R-06, R-15, R-16, R-19, R-20. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/jobs/job-stores.pg.ts

Related scope: B-07, B-08, B-12, R-04, R-05, R-06, R-11, R-12, R-16, R-17, R-20. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/server.ts

Related scope: B-22, B-27. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: backend/src/worker.ts

Related scope: B-08, B-11, B-12, R-04, R-06, R-15, R-16, R-19, R-20. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: backend/tests/infrastructure-safety.ts

Related scope: B-17. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tests/integration/account-archive.test.ts

Related scope: B-18. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/auth-flow.test.ts

Related scope: B-27. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/calendar-flow.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/error-handler.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/goals-flow.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/habits-flow.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/health.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/ingest-analyze-flow.test.ts

Related scope: B-24. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/ingest-flow.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/middleware.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/money-flow.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/notes-flow.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/query-surface.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/reminders-flow.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/schema-constraints.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/tasks-flow.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/timer-sessions-flow.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/timer-without-task.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/transaction-runner.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/users-flow.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/integration/worker-jobs.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/security/auth-security.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/security/security-headers.test.ts

Related scope: B-17 / B-16. First-import destructive-target guard and focused regressions; actual owned current-schema integration/security C15/C16 via C32, not deployed resources or mobile E2E.

### M: backend/tests/setup.ts

Related scope: B-17. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tests/test-safety.ts

Related scope: B-17. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tests/unit/account-archive.test.ts

Related scope: B-18. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### M: backend/tests/unit/account-deletion.test.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tests/unit/account-export.test.ts

Related scope: B-16, B-18. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tests/unit/auth-transactions.test.ts

Related scope: B-16, B-27. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### M: backend/tests/unit/env.test.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### M: backend/tests/unit/ingest-analyze.test.ts

Related scope: B-24. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### M: backend/tests/unit/job-processors.test.ts

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### M: backend/tests/unit/logger-redaction.test.ts

Related scope: B-16, B-18. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### M: backend/tests/unit/otp-service.test.ts

Related scope: B-10, B-17. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tests/unit/production-db-defaults.test.ts

Related scope: B-09, B-16, B-31. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### M: backend/tests/unit/rate-limiter.test.ts

Related scope: B-16, B-18. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tests/unit/remediation-regressions.test.ts

Related scope: B-16, B-27, B-28. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tests/unit/reset-request-dispatcher.test.ts

Related scope: B-13, B-27. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tests/unit/sensitive-actions.test.ts

Related scope: B-16, B-18. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### M: backend/tests/unit/startup-ddl-guard.test.ts

Related scope: P0-01. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tests/unit/upload-boundary.test.ts

Related scope: B-15. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: backend/tsconfig.verification.json

Related scope: B-16, B-24. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docker-compose.yml

Related scope: B-09, B-31, R-10, R-18. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docker/Dockerfile

Related scope: B-09 / R-10 / R-18 / B-32. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: docker/docker-compose.yml

Related scope: B-31, B-32. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/api/account-archive.md

Related scope: B-18. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/api/conventions.md

Related scope: B-14, B-20. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/api/openapi.yaml

Related scope: B-14, B-27. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/architecture/deferred-and-non-goals.md

Related scope: B-05, B-15, B-20. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/architecture/design-decisions.md

Related scope: B-03, B-04, B-15, R-22. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/architecture/tasks.md

Related scope: B-19. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/database/migrations.md

Related scope: B-20. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/database/upgrades/2026-10-ingest-tokens-and-optional-timer-task.sql

Related scope: B-09 / R-10 / R-18 / B-32. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/deployment/docker.md

Related scope: B-09 / R-10 / R-18 / B-32. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/development/local-setup.md

Related scope: B-09, B-31, R-10. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/development/testing.md

Related scope: B-20. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/mobile/account-archive.md

Related scope: B-18. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/mobile/build-preparation.md

Related scope: B-30. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/mobile/digital-detox.md

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/mobile/flutter-integration.md

Related scope: B-05, B-20. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/apply-patch.md

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/checks.json

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/counts.json

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/deletions.json

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/disposable-results.json

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/evidence/C01.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C02.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C03.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C04.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C05.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C06.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C07.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C08.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C09.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C10.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C11.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C12.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C13.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C14.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C25.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C26.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C27.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C28.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C29.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C30.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C31.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C32.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C33.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C34.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C36.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C37.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/C38.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/iterations/predevice-first-C04.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/evidence/iterations/predevice-first-C32.txt

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Capture actual command output; scopes and exit codes are in checks.json.

### A: docs/remediation/finding-matrix.md

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/findings.json

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/follow-up-hardening.md

Related scope: B-18. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/history-provenance.json

Related scope: B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/history-scan.json

Related scope: B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/report.md

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/runtime-and-cleanup.md

Related scope: B-07, B-27, R-22. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/secret-triage.json

Related scope: B-09, B-20, B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/secret-triage.md

Related scope: B-09, B-20, B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/sensitive-actions.md

Related scope: B-18. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/session-and-scanner-hardening.md

Related scope: B-20, B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/remediation/verification-history.md

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/reports/phase-p2-delivery-report.md

Related scope: B-20. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/reports/phase-p5-delivery-report.md

Related scope: B-20. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: docs/security/local-audio-boundary.md

Related scope: B-15. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/security/p2-security-review.md

Related scope: B-20. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: docs/security/p3-security-review.md

Related scope: B-20. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### M: mobile-app/mobile/.gitignore

Related scope: B-32. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/android/app/build.gradle.kts

Related scope: B-30. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/android/app/src/main/AndroidManifest.xml

Related scope: B-01, B-30, R-08. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### D: mobile-app/mobile/android/app/src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java

Related scope: B-32. Remove specifically audited duplicate/generated artifact; regeneration/build remains unverified.

### A: mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/AccountArchiveBridge.kt

Related scope: B-18. Android private staging/SAF chooser, verified plaintext copy/readback and cleanup source; Android compile/provider/device gates BLOCKED.

### A: mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/AccountArchiveStage.kt

Related scope: B-18. Actual Android-free AES-GCM staging class/harness: C30 JVM checks; no Android bridge/provider/app/device build proof.

### M: mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/FocusShieldAccessibilityService.kt

Related scope: Digital Detox. Truthful partial platform enforcement, owner-scoped release and persisted explicit session lifecycle; device proof BLOCKED.

### M: mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/FocusShieldBridge.kt

Related scope: Digital Detox. Truthful partial platform enforcement, owner-scoped release and persisted explicit session lifecycle; device proof BLOCKED.

### M: mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/FocusShieldSessionStore.kt

Related scope: Digital Detox. Truthful partial platform enforcement, owner-scoped release and persisted explicit session lifecycle; device proof BLOCKED.

### M: mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/MainActivity.kt

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/SmsTransactionReceiver.kt

Related scope: B-03. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/VoiceActionReceiver.kt

Related scope: R-22. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/VoiceRecordingService.kt

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/WalletCredentialStore.kt

Related scope: B-01, R-08. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: mobile-app/mobile/android/app/src/main/res/xml/backup_rules.xml

Related scope: B-01 / R-08. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: mobile-app/mobile/android/app/src/main/res/xml/data_extraction_rules.xml

Related scope: B-01 / R-08. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/app.dart

Related scope: Digital Detox. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: mobile-app/mobile/lib/core/archive/archive_cancellation.dart

Related scope: B-18. Bounded archive validation/coordinator/explicit consent source; C12 syntax only, Flutter/widget/provider execution BLOCKED.

### A: mobile-app/mobile/lib/core/archive/archive_export.dart

Related scope: B-18. Bounded archive validation/coordinator/explicit consent source; C12 syntax only, Flutter/widget/provider execution BLOCKED.

### A: mobile-app/mobile/lib/core/archive/archive_verifier.dart

Related scope: B-18. Bounded archive validation/coordinator/explicit consent source; C12 syntax only, Flutter/widget/provider execution BLOCKED.

### A: mobile-app/mobile/lib/core/money/decimal_amount.dart

Related scope: B-33. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/data/api_client.dart

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/features/ai/presentation/ai_assistant_screen.dart

Related scope: R-21. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/features/auth/data/auth_repository.dart

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: mobile-app/mobile/lib/features/auth/presentation/account_archive_dialog.dart

Related scope: B-18. Bounded archive validation/coordinator/explicit consent source; C12 syntax only, Flutter/widget/provider execution BLOCKED.

### A: mobile-app/mobile/lib/features/auth/presentation/account_export_dialog.dart

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: mobile-app/mobile/lib/features/auth/presentation/current_password_dialog.dart

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/features/auth/presentation/profile_screen.dart

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/features/auth/state/auth_provider.dart

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/features/calendar/data/calendar_repository.dart

Related scope: B-12, R-04, R-06, R-16, R-20. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: mobile-app/mobile/lib/features/digital_detox/detox_platform.dart

Related scope: Digital Detox. Truthful partial platform enforcement, owner-scoped release and persisted explicit session lifecycle; device proof BLOCKED.

### A: mobile-app/mobile/lib/features/digital_detox/detox_provider.dart

Related scope: Digital Detox. Truthful partial platform enforcement, owner-scoped release and persisted explicit session lifecycle; device proof BLOCKED.

### A: mobile-app/mobile/lib/features/digital_detox/detox_screen.dart

Related scope: Digital Detox. Truthful partial platform enforcement, owner-scoped release and persisted explicit session lifecycle; device proof BLOCKED.

### A: mobile-app/mobile/lib/features/digital_detox/detox_session.dart

Related scope: Digital Detox. Truthful partial platform enforcement, owner-scoped release and persisted explicit session lifecycle; device proof BLOCKED.

### M: mobile-app/mobile/lib/features/home/presentation/home_shell.dart

Related scope: Digital Detox. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/features/money/data/wallet_ingest_token.dart

Related scope: B-01, R-08. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/features/money/presentation/money_screen.dart

Related scope: B-33. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/features/more/data/daily_plan_models.dart

Related scope: B-06, R-01, R-07. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/features/more/presentation/more_screen.dart

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/l10n/app_localizations.dart

Related scope: B-05, B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/l10n/catalog_ar.dart

Related scope: B-27. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/l10n/catalog_de.dart

Related scope: B-27. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/l10n/catalog_en.dart

Related scope: B-18, B-27. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/l10n/catalog_es.dart

Related scope: B-27. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/l10n/catalog_fr.dart

Related scope: B-27. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/lib/l10n/catalog_tr.dart

Related scope: B-27. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/pubspec.lock

Related scope: B-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: mobile-app/mobile/pubspec.yaml

Related scope: B-15, B-18, R-23. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: mobile-app/mobile/test/account_archive_dialog_test.dart

Related scope: B-18. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: mobile-app/mobile/test/account_archive_test.dart

Related scope: B-18. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: mobile-app/mobile/test/account_archive_transport_test.dart

Related scope: B-18. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: mobile-app/mobile/test/account_export_dialog_test.dart

Related scope: B-16, B-18. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: mobile-app/mobile/test/current_password_dialog_test.dart

Related scope: B-18. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### M: mobile-app/mobile/test/daily_plan_and_lifecycle_test.dart

Related scope: Cross-cutting remediation support; see findings.json and exact diff. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: mobile-app/mobile/test/decimal_amount_test.dart

Related scope: B-33. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: mobile-app/mobile/test/digital_detox_test.dart

Related scope: B-16. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### A: mobile-app/mobile/test/fixtures/account_archive_v1.ndjson

Related scope: B-18. Synthetic exact-byte archive fixture/source-contract checks C29; no Dart or Android runtime execution.

### M: mobile-app/mobile/test/wallet_ingest_token_test.dart

Related scope: B-01 / R-08. Regression test/fake/contract updates; backend C03/C06, Flutter C20 BLOCKED as applicable.

### M: schema.sql

Related scope: B-09, B-19, R-10, R-18. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/android-build-preparation.test.mjs

Related scope: B-30. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/archive-mobile-contract.test.mjs

Related scope: B-18. Synthetic exact-byte archive fixture/source-contract checks C29; no Dart or Android runtime execution.

### A: scripts/check-archive-stage.py

Related scope: B-18. Actual Android-free AES-GCM staging class/harness: C30 JVM checks; no Android bridge/provider/app/device build proof.

### A: scripts/check-dart-syntax.mjs

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/check-environment.mjs

Related scope: B-17, B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/check-environment.test.mjs

Related scope: B-16, B-17, B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: scripts/check-forbidden.mjs

Related scope: B-15. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/check-forbidden.test.mjs

Related scope: B-15. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/ci-database-env.mjs

Related scope: B-09, B-31, R-10. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/ci-resource-guard.mjs

Related scope: B-17, B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/ci-resource-guard.test.mjs

Related scope: B-17, B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: scripts/ensure-env.sh

Related scope: B-17, B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/kotlin/AccountArchiveStageHarness.kt

Related scope: B-18. Actual Android-free AES-GCM staging class/harness: C30 JVM checks; no Android bridge/provider/app/device build proof.

### A: scripts/local-setup.mjs

Related scope: B-09, B-31, R-10. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/local-setup.test.mjs

Related scope: B-09, B-31, R-10. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/local-stack.mjs

Related scope: B-09, B-31, R-10. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/native-voice-cleanup.test.mjs

Related scope: R-22. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/package-remediation.py

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/prepare-android-signing.mjs

Related scope: B-30. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/review-history-provenance.py

Related scope: B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/run-disposable-verification.py

Related scope: B-07. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/scan-git-history.py

Related scope: B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/scan-secrets.mjs

Related scope: B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/verify-android-apk.mjs

Related scope: B-30. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### M: scripts/verify-ci.sh

Related scope: B-17, B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: scripts/verify-remediation.py

Related scope: B-16 / B-20 / B-32; cross-cutting evidence. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: tools/security/.secretlintignore

Related scope: B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

### A: tools/security/.secretlintrc.json

Related scope: B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: tools/security/package-lock.json

Related scope: B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: tools/security/package.json

Related scope: B-31. Contract/configuration/runbook/traceability update; precise intent in linked findings and diff.

### A: tools/security/rules/parseable-private-key.mjs

Related scope: B-31. Focused source/build/security remediation; root cause and residual scope in linked finding records.

## Remaining release gates and next actions

1. Owned current-schema runtime/migration fixtures now execute under C15-C17/C32. Rehearse the actual legacy deployment/restore separately (C35 BLOCKED); never point destructive cleanup at live data.

2. Install Flutter/Dart and Android toolchains; run analysis, all unit/widget tests and native builds. Use an actual signing key out of band and verify signatures; test Keystore migration, backup exclusions and Detox enforcement/release/recovery on devices. Verify archive transport/identity/cancellation, private staging, chooser, plaintext/cloud consent, readback and provider failures, expiry/disposal/orphan cleanup on devices. Resolve any compile/lifecycle failures before release.

3. Verify real SMTP delivery/failure, shutdown and statistical load/timing behavior. B-27 now admits bounded volatile requests before lookup/cooldown/SMTP; targeted tests do not prove constant-time behavior or durable delivery. B-07 audit/session retention and large-account/other-platform export/clipboard scope remain partial; measure and implement approved policies without deleting live data or exposing credentials.

4. Resolve original-policy ambiguities (including thresholds; local-audio policy is now clarified), broader search/index coverage, noncritical casts/dead/duplicate voice code and container-image scanners. Assess C36 historical matches and any deployed reuse without rewriting history or suppressing detectors. Do not mark source-only fixes or the partially enforced Android Detox as fully implemented.

5. Rehearse deployment/restore using the real legacy schema/history, review all partial/unverified records and obtain release approval. Safe delivery of this subset is not proof of full completion.
