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
