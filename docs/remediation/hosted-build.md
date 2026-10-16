# Owner-authorized hosted verification — 2026-10-16

The owner explicitly authorized commit/push and CI on `arena/3f871eac-life-style-app`.
Only that branch is used. No merge into main, deploy, release-key generation or user
service/data cleanup is authorized/performed. Repository administration settings could
not be read with the integration token, but actual branch push and CI execution work;
no passwords/tokens were requested or stored.

The exact branch was added to the existing push trigger. Original source-provenance
fingerprints remain, with reasoned follow-up chains for CI edits. The patch packager
now verifies baseline ancestry instead of requiring HEAD to equal the pre-commit
baseline; it still packages the entire delta from that baseline, not just uncommitted
changes. The syntax helper also compares against the baseline after commits, not an
empty HEAD diff.

Actual initial hosted runs:

- 38903126842 (`c0dc175`): backend PASS; mobile FAIL on formatting/analyzer diagnostics,
  Flutter tests step success, Android build not reached. Retrieved the official
  formatter's diagnostic patch, checked/apply patch and corrected the reported rules.
- 38903766199 (`5492929`): backend PASS; remaining mobile analysis diagnostics FAIL;
  Flutter tests step success. GitHub reports only a limited number of annotations
  per step, so the first ten messages are not an exhaustive diagnostic inventory.
- 38904359227 (`862af92`): backend PASS with the new shutdown tests; analysis still
  FAIL on additional reported brace diagnostics. No APK/native result inferred.
- 38904866557 (`1b85bea`): full official `dart fix` candidate requested on the FAILED
  analysis path. That step still exits nonzero and cannot build/upload an APK. The
  candidate is a source correction to review/commit, never a replacement for rerunning
  analysis against the actual committed source or a reason to relax fatal analysis.

Raw GitHub log download redirects are unreachable from this sandbox. Metadata and
source-only diagnostic annotations are retrieved through the GitHub API; no temporary
signed URLs or raw credentials are retained in repository evidence. Historical failed
runs remain available on GitHub, not relabeled PASS. A test step succeeding in a failed
format/fix-candidate workspace is not final source-pinned application certification.

`hosted-build.json` and C39/C40 will record fresh run/job/step/artifact metadata for
the selected actual run. Recording refuses application/workflow drift from that SHA
or untracked application source and never accepts stale metadata if API validation
fails. C19/C20 may become actual hosted PASS only from those verified step outcomes.
C21 remains owner-key signed-release scope, C24 remains image-security scope and
physical-device/provider/connected-backend/E2E outcomes remain separate.

A debug validation build intentionally uses an offline `.invalid` API unless an
explicit approved disposable HTTPS test backend is selected. It is not usable for
server-dependent feature verification merely because it installs. No existing live
API is contacted or substituted without an explicit test configuration. Signed
release remains manually gated on main with owner-provided existing keys out of band;
the session branch does not merge or trigger that job.

## Shutdown correction and actual process test

Inspection found shutdown closed auxiliary listeners without waiting for their
active HTTP requests. Added a small production `drainApiWork` helper: stop reset
admission, await every HTTP listener's close, then await accepted volatile reset
work, before Redis/PG close. The bounded forced-exit timer remains and logs only
sanitized counts/fixed failure descriptions. A never-bound auxiliary listener is
handled explicitly; other close failures are not silently ignored.

Two tests execute: an unbound-listener case and an actual Node subprocess with two
loopback HTTP listeners, an active auxiliary response, the production reset dispatcher
and OS SIGTERM. Late admission is refused, the process stays alive until BOTH the
HTTP response and pending worker finish, and exits zero only after drain. This is
real process/socket/component evidence, not an actual production server entrypoint
with live SMTP/PG shutdown/inbox delivery certification. The worker gate is explicitly
a controlled fixture, not a fake successful mail integration. Backend unit count is
342/31 files; final C06 evidence governs subsequent reruns.


Further actual diagnostic iterations (never marked successful):

- 38905354494 (`ac9d64c`): official curly-brace fixes applied, remaining analysis
  warning/infos caused FAIL. Optional fixer found no remaining curly diagnostic,
  exposing a diagnostic-path issue: original output needed emission before repair.
  The source-pinned failed API metadata is retained in evidence/iterations.
- 38905852693 (`376360f`): original analyzer output retrieved, exactly three remaining
  diagnostics: two archive-test string interpolation infos and an unused optional
  token parameter on a test-only credential fixture. Corrected those exact items;
  no analyzer rule, test assertion, permission or feature behavior was relaxed.
- 38906344242 (`1c764b8`): next actual run selected for source-pinned verification;
  its current outcome is recorded in hosted-build.json, not inferred in advance.

An optional fixer is diagnostic-only and its own refusal is explicitly annotated.
C19/C20 never inherit source-pinned PASS from a failed formatter/analyzer workspace;
clean prerequisite steps are required. CI has no publish/deploy command and no
release credentials in its automatic debug job.


Additional validation isolation:

- After the first clean analysis/test run reached actual Android JVM compilation,
  made the debug app a separate `.validation` application ID/label to avoid asking a
  tester to replace/uninstall any existing signed application or lose user data.
- 38906759617 (`4d10515`) is that intermediate build. A request to cancel the now-
  superseded run was refused with integration HTTP403; no permissions were changed,
  alternative authorization attempted or cancellation success claimed.
- 38907331058 (`9d84d44`) also verifies the actual compiled APK manifest package via
  SDK aapt2 as well as its debug signature, before artifact upload. Current outcome
  is recorded only by fresh source-matched metadata, never anticipated here.


SDK verification failure and correction:

- 38906344242 reached clean Flutter analysis/tests, actual Android JVM tests and APK
  compilation. Its signature-policy gate failed and prevented upload; native build
  success was not incorrectly presented as a distributable APK.
- 38908093008 (`dbf51e6`) emitted bounded public diagnostic facts: actual SDK37
  cryptographic command succeeded, signer count one and debug subject present, but
  the old human SHA256-text matcher did not match. No raw SDK stderr/key/DN was logged.
- Replaced dependence on SDK human digest labels in the actual CLI with one actual
  SDK-verified public certificate PEM, parsed by Node X509Certificate to compute
  fingerprint256 and check subject. Single signer, expected public fingerprint,
  non-debug release identity and exact APK package checks remain fail-closed.
- 38909865820 (`e2d6577`) adds a real SDK fixture job: generate a transient test-only
  key and minimal packaging probe under a private owned runner directory, sign and
  verify with the SDK, delete its directory, and publish NO fixture artifact. That
  job PASS is a verifier-tool probe, not LifeStyle functionality or device evidence.
  The actual application build/signature/manifest/upload is separately C40. No owner
  release key was generated or requested, and no unsigned artifact is offered.


## Final actual successful application run — 38909865820

Built source: `e2d6577c04d329695b402965a65f4ccdbd2c23e8`, fixed session branch.
Backend quality/security/API-contract gate PASS; clean Dart format, Flutter static
analysis and Flutter suite PASS; actual Android Kotlin JVM tests and application
APK compilation PASS. Actual SDK apksigner cryptographic/public-certificate policy
and aapt2 COMPILED package identity (`com.lifestyle.app.validation`) PASS. Only then
was the actual application APK artifact uploaded. Real SDK fixture probe separately
PASS; no fixture APK is published. Owner-key release job NOT RUN (not dispatched).

Actual artifact, GitHub-reported metadata:
- Name: `lifestyle-android-debug-validation-NOT-RELEASE`
- ID: `12050352682`; archive size: 86,214,128 bytes.
- GitHub-reported archive SHA256: `73eaaab259c064480243543a4532e87ce2ebbd2838a1fe558d1e0f0d0a5f4f58`.
- Download: https://github.com/KarimOmarShawky/life-style-app/actions/runs/38909865820/artifacts/12050352682
- Direct sandbox download through gh API: BLOCKED by artifact retrieval/network
  failure; no local APK or independent downloaded-archive/inner-APK SHA256 is
  claimed. Download through the authenticated GitHub page instead. C40 is actual
  hosted verification/upload plus fresh API artifact evidence, not local retrieval.
- CI emits action-version/runner-image deprecation and nonfatal cache-save warnings.
  These are disclosed, not represented as clean warning-free logs; application fatal
  analysis rules remain enabled and all application gates above PASS.

The API endpoint is intentionally `https://validation.invalid/api/v1`. Auth routing
shows AuthScreen until a real authenticated account exists; therefore this APK can
verify installation/startup but cannot log in or exercise backend-dependent app
features offline. There is NO guest/authentication bypass, fake account, mock server
or manufactured successful response. Full trial requires explicit approval of a
separate disposable HTTPS test API and rebuilding with that URL. Do not silently
use the app's original production default or treat .invalid as a working server.
No merge, deployment, user-server/database changes, release identity or phone install
occurred. Signed release, device/provider/SMTP, full E2E, Docker Compose/legacy restore
and history credential-reuse assessment remain separate incomplete scopes.


## Later owner-approved temporary pilot — not a successful connected APK

The owner explicitly requested a new temporary backend. Built and started a NEW
owned PostgreSQL16.14/Redis7.4.6 cluster with runtime-only API credentials. Fresh
bootstrap/forward migrations and real local 12-check API smoke PASS. The fixture
accounts use synthetic data and random in-memory credentials, never logs. SMTP
is an explicit421 rejection, not a fake successful delivery. Existing user servers,
records/configuration and main remain untouched. Pilot files/secrets are outside Git.

Manual workflow dispatch was denied403 by integration; ordinary authorized branch
push/CI continued without alternate credentials or privilege changes. Run38914530509
also preserved a failing source-contract assertion; the explicit manual/offline
fallback contract was retained and a stronger mandatory-probe regression added.
Runs38914632434/38914942984 attempted real external HTTPS. The latter's bounded
annotation proves readiness HTTP403 before a successful API probe (job117019887767,
source f55b45f). No connected APK was compiled/accepted. The subsequent SDK commands
had no installed Flutter because early setup was skipped, not an app-source regression.
Those prerequisite conditions and formatter-diagnostic triggers were corrected.

Restored offline default on all refs; run38915340992 at4d69890 is an OFFLINE recovery
validation, never connected-pilot proof. Check its fresh C39/C40 outcome rather than
assuming it succeeded before completion. C41 remains BLOCKED on the actual public403.
No sandbox credential is extracted, shared or embedded in the APK to bypass ingress;
no production endpoint, fake auth or successful stub is substituted. Source/body
and artifact evidence from successful earlier builds remain historical and scoped.


### Actual offline recovery completed

Run38915340992 / 4d698901164d5306055d3f33a32a864b74e49209 PASS: backend gate,
clean Dart format/Flutter analysis/test, actual Kotlin JVM/application debug build,
SDK certificate/compiled-package verification and actual upload. The pilot HTTPS
step is explicitly NOT RUN in this offline recovery, not silently PASS. Actual
artifact12052199765 is 86,214,126-byte GitHub-reported archive with reported SHA256
6f66be23d962a08d0ef046fa88566a7fbdf6be301a15b292a22c21684fb5dd27:
https://github.com/KarimOmarShawky/life-style-app/actions/runs/38915340992/artifacts/12052199765
It is offline and NOT a connected phone trial, not downloaded/installed locally or
independently hashed as an APK in this session. C41 remains BLOCKED on real ingress403.
C37 now has17 source/negative/parser guards including mandatory connected-probe scope.
Final local full regression re-executed separately on newly owned fixtures; source
scan/current Git-history coverage and exact counts are the final C25/C36/C38 evidence.
