# Dependency and secret hygiene (E2)

> **Historical snapshot — 2026-11-10.** The advisory counts and dispositions
> below were recorded on branch `arena/db60a1d0-life-style-app` (PR #30) and are
> only valid for the commit cited in the Phase 1 report. Re-run the commands
> before relying on them.

This page records the guide's E2 requirements: clean lockfile installs, an
advisory scan, a disposition for every actionable production advisory, and a
manual rotation checklist. Secrets are never rotated automatically and Git
history is never rewritten without a separate, explicit owner decision.

## 1. Commands and results

| Tree | Command | Before (05f7a04) | After (this change) |
|---|---|---|---|
| `backend/` | `npm ci` | PASS | PASS (clean install from the updated lockfile) |
| `backend/` | `npm audit --omit=dev --audit-level=high` | exit 0 (3 moderate) | exit 0, **0 vulnerabilities** |
| `backend/` | `npm audit` (all dependencies) | 9 moderate | **0 vulnerabilities** |
| `tools/security/` | `npm audit` (dev-only scanner) | 1 moderate (`fast-uri`) | **0 vulnerabilities** |
| repository root | `package.json` has no dependencies | n/a | n/a |
| `mobile-app/mobile/` | `flutter pub get` | CI only (no local Flutter SDK) | CI only |
| `mobile-app/mobile/` | Dart/pub advisory scan | **NOT RUN**: no pub advisory scanner is wired into CI | NOT RUN (see section 4) |
| whole worktree | `node scripts/scan-secrets.mjs` (isolated secretlint) | PASS, 0 findings | PASS, 0 findings |
| whole worktree | Trivy filesystem scan, HIGH/CRITICAL, enforced | PASS in CI | runs in CI on every PR |

## 2. Disposition table

| Advisory | Package path | Scope | Disposition | How it was fixed | Verification |
|---|---|---|---|---|---|
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) (glob AbortSignal bypass, `>=9.0.0 <=14.0.1`) | `node-pg-migrate@9.0.0 → glob@13.0.6`; `rimraf@6.1.3 → glob@13.0.6` | production (migration CLI) + dev | **Fixed** | `overrides.glob = ^14.0.4` in `backend/package.json` | `npm ls glob` shows 14.0.4 (overridden); `npm audit` is clean |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (minimatch globparts amplification, `>=7.0.0 <11.0.1`) | `glob@13 → minimatch@10.2.6`; `@typescript-eslint/typescript-estree@8.70.1 → minimatch@10.2.6` | production (via glob) + dev (lint) | **Fixed** | glob 14 depends on `minimatch ^11.0.5`; scoped override `@typescript-eslint/typescript-estree → minimatch ^11.0.5` | `npm ls minimatch` shows 11.0.6 on both paths; ESLint's own `minimatch@3.1.5` (outside the vulnerable range) is untouched |
| `@typescript-eslint/*`, `rimraf` (moderate, inherited from the two advisories above) | dev | dev | **Fixed** by the same overrides | — | `npm audit` is clean |
| GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp (`fast-uri <3.1.9`) | `secretlint → ajv@8.20.0 → fast-uri` | dev-only tool, never shipped | **Fixed** | `npm audit fix` (semver-compatible lockfile bump to 3.1.9) in `tools/security/` | `npm audit` is clean; the secret scan still passes |

### Why the overrides are safe

- **API surface.** Between glob 13.0.6 and 14.0.4 the published `index.d.ts`
  differs only in type-only imports. In the options, `debug` was removed and
  `normalize` was added. node-pg-migrate calls `glob(dir, { ignore, nodir,
  withFileTypes })`, and only with `--use-glob`, which this repository's
  `migrate:*` scripts never pass. typescript-estree calls only
  `minimatch(path, pattern, { dot: true })`.
- **Engines.** glob 14 supports Node `18 || 20 || >=22` and minimatch 11
  supports `20 || >=22`. CI uses Node 24 and the Docker image uses Node 24.
- **Executed proof.** With the overrides, a clean `npm ci` passed, followed by
  typecheck, typecheck:tests, lint, format:check, clean + build, a fresh
  `migrate:up` run twice, and the full Vitest suite on disposable PostgreSQL
  16 + Redis. The Phase 1 report cites the exact counts and the hosted CI run.
- **Rollback.** Remove the `overrides` block and run `npm install` to restore
  the previous lockfile resolution. No application code depends on it.

Re-check this disposition when node-pg-migrate publishes a release that
accepts glob 14 on its own. Then drop the `glob` override.

## 3. Secret rotation checklist (manual, owner-run)

Rotation is an owner action. Nothing in CI rotates secrets. Rotate when a
secret may have been exposed, when someone with access leaves, or on the
owner's schedule. Never paste secret values into issues, chat, commits or
logs. The deployment secret stores are Railway variables, the owner's
password manager and the GitHub `android-release` environment.

| Secret | Where it lives | Rotation steps | User impact |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | Railway | 1. Generate 32+ random bytes. 2. Set the old value as `JWT_ACCESS_SECRET_PREVIOUS` and the new value as `JWT_ACCESS_SECRET`. 3. Redeploy. 4. After at least `ACCESS_TOKEN_TTL_SECONDS` (default 15 minutes), remove `JWT_ACCESS_SECRET_PREVIOUS` and redeploy. | None. Refresh tokens are opaque and stored hashed, so they keep working. |
| `OTP_HMAC_SECRET` | Railway | Replace and redeploy. | Password-reset codes already in flight stop working. Users request a new code. |
| `DATABASE_URL` (`lifestyle_app`) | Railway, password manager | `ALTER ROLE lifestyle_app PASSWORD …` in the Neon SQL editor, then delete that history entry. Update Railway and redeploy. | A brief reconnect. |
| `DATABASE_MIGRATION_URL` / `DATABASE_MAINTENANCE_URL` | owner only | Same as above for `lifestyle_migrator` / `lifestyle_maintenance`. | None. |
| `GEMINI_API_KEY` | Railway | Create a new key in the provider console, update Railway, redeploy, then revoke the old key. | AI calls fail closed (503) during the switch. |
| `EMAIL_USER` / `EMAIL_PASSWORD` | Railway | Rotate at the SMTP provider, then update Railway. | Password-reset emails pause during the switch. |
| `FCM_CREDENTIALS` | not configured (push is stubbed) | Create a new service-account key, then delete the old one. | n/a until E3. |
| Android signing (`ANDROID_KEYSTORE_*`, `ANDROID_KEY_*`) | GitHub `android-release` environment | Do **not** replace the app signing key casually: installed apps only accept updates signed by the same key. Use Play App Signing upload-key reset if the upload key leaks. | Store-update continuity. |
| Neon console / Railway / GitHub accounts | owner | Enable 2FA. Review members and tokens. Revoke unused personal access tokens. | None. |

After any suspected exposure:

1. Rotate the affected secret first.
2. Then review access logs.
3. Then decide, as a separate decision, whether history cleanup is needed.
   History rewrites need explicit owner approval because they break every
   clone.

## 4. Open items (owner decisions)

- **Dart/pub advisories: NOT RUN.** CI resolves `pubspec.lock` but does not
  scan it. Recommendation: add an OSV scanner step for `pubspec.lock` in CI.
  It needs only read access and no new runtime dependency.
- **Image scanning.** Trivy scans the filesystem, not the built container
  image. A container-image scan stays an owner decision for the release phase
  (E1/E10).
