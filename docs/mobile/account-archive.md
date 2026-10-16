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
