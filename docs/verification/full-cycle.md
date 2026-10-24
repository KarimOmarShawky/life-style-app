# Full verification cycle

How to produce the evidence the 2026-10-24 audit asked for in its **P1 item 7**:
"a release candidate needs actual backend, mobile, native, DB, worker, image and
deployment evidence; static review alone cannot close these gates."

One command runs every gate it can and is honest about the rest:

```bash
node scripts/run-full-verification.mjs --json verification-$(date +%F).json
```

## Status vocabulary

| Status | Meaning |
| :--- | :--- |
| `PASS` | The gate's real command ran and succeeded. |
| `FAIL` | It ran and failed. The exit code becomes 1. |
| `BLOCKED` | It cannot run here: a toolchain, SDK, service or env var is missing. |
| `NOT RUN` / `SKIPPED` | Deliberately not attempted (`--skip`). |

`BLOCKED` is never a pass. Use `--require <gate>` to promote it to a hard
failure, which is how a release-candidate run should be invoked:

```bash
node scripts/run-full-verification.mjs \
  --require migrations --require backend-integration --require flutter --require android
```

Exit codes: `0` = every gate that ran passed · `1` = a gate failed ·
`2` = a required gate did not produce evidence.

## Gates

| Gate | Runs | Needs |
| :--- | :--- | :--- |
| `contracts` | every `scripts/*.test.mjs` (source-level invariants) | Node only |
| `docs` | `scripts/check-docs-consistency.mjs` (F-08 guard) | Node only |
| `backend-quality` | forbidden-dependency guard, prettier, eslint, `tsc --noEmit`, `tsc -p tsconfig.verification.json`, `npm run build` | backend `npm ci` |
| `backend-unit` | `npm run test:unit` | backend `npm ci` |
| `migrations` | `npm run migrate:up` **twice** (idempotency) | disposable PostgreSQL |
| `backend-integration` | `npm run test:integration` + `npm run test:security` | disposable PostgreSQL + Redis |
| `backend-coverage` | `npm run test:coverage` (vitest thresholds) | same as above |
| `audit` | `npm audit --omit=dev --audit-level=high` | backend `npm ci` |
| `flutter` | `flutter --version`, `pub get`, `analyze`, `test` | Flutter SDK on `PATH` |
| `android` | `./gradlew testDebugUnitTest` | Java + `ANDROID_HOME`/`ANDROID_SDK_ROOT` |
| `apk` | `scripts/verify-android-apk.mjs` (real `apksigner`) | built APK + Android SDK |
| `trivy` | `trivy fs --severity HIGH,CRITICAL --exit-code 1` | `trivy` binary |

`node scripts/run-full-verification.mjs --list` prints the ids; `--skip <gate>`
removes one; `--help` prints usage.

## Database gates are guarded, never implicit

`migrations`, `backend-integration` and `backend-coverage` are refused unless
`scripts/check-environment.mjs` accepts the environment in `isolated` mode:

```bash
export DATABASE_URL='postgresql://lifestyle_app:<pw>@localhost:5432/lifestyle_test'
export DATABASE_MIGRATION_URL='postgresql://lifestyle_migrator:<pw>@localhost:5432/lifestyle_test'
export REDIS_URL='redis://localhost:6379/1'
export ALLOW_DESTRUCTIVE_TESTS='isolated-resources-only'
```

The guard requires the application role (`lifestyle_app`) and the migration
role (`lifestyle_migrator`) to point at the **same** host/port and a
`/lifestyle_test*` database, a non-zero Redis database index, no query or
fragment overrides, and the explicit acknowledgement above. Those are
guardrails, not proof of isolation — the operator still owns the disposable
targets. `docker compose` (root `docker-compose.yml`) or
`node scripts/local-stack.mjs --start` brings up a local pair.

## Suggested sequence for a clean cycle

1. **Fresh checkout**, nothing reused from a previous run:
   `npm ci --prefix backend` and, for the mobile gates, `flutter pub get`.
2. **Fast gate first** — `node scripts/run-full-verification.mjs` with no
   arguments. Fix every `FAIL` before going further.
3. **Start disposable services**, export the four variables above, then re-run
   with `--require migrations --require backend-integration`.
4. **Mobile and native** on a machine with the SDKs, with
   `--require flutter --require android`.
5. **Artifact** — build the APK, then
   `VERIFY_APK_MODE=debug VERIFY_APK_PATH=... node scripts/run-full-verification.mjs --require apk`.
6. **Record** — keep the `--json` output and the console log as the run's
   evidence. Both are needed: the summary alone does not show which commands ran.

## What this script does not cover

It orchestrates commands; it does not stand in for them. Still manual, and
still required before sign-off:

- Image scanning of the **built** image (CI covers the filesystem scan).
- Provider verification: SMTP delivery, the Gemini fallback with a real key,
  and push (there is no push provider yet — see F-04).
- Physical-device runs: wallet SMS capture, Keystore migration across a device
  restore, backup/restore and rollback rehearsals, notification behaviour.
  `docs/mobile/manual-test-checklist.md` is the device checklist; SMS-F-8 there
  covers the stalled-fallback state added for F-02.
- Localization/RTL, accessibility, offline/interruption and digital-wellbeing
  passes, plus monitoring and alert-delivery checks.

## Related entry points

- `bash scripts/verify-ci.sh --unit` — the backend-only subset, safe by default
  (no migrations, no destructive suites).
- `bash scripts/verify-ci.sh --isolated` — adds migrations and coverage against
  explicitly owned disposable targets.
- `node scripts/check-docs-consistency.mjs` — the F-08 documentation guard on
  its own.
