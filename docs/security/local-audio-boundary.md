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
