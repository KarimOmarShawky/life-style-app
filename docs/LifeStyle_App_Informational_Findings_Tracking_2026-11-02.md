# Informational Findings Tracking — AUD-15 through AUD-20
**Branch**: `arena/1619e266-life-style-app`  
**Date**: 2026-11-02  
**Audit Reference**: `LifeStyle_App_Final_Independent_Verification_Audit_Report.pdf` (audit date 2026-11-01)

## AUD-15 — Moderate dependency advisories

**Finding**: 14 moderate advisories (3 in production via node-pg-migrate→glob→minimatch,
tools 1 fast-uri).

**Status**: Tracked — upgrade plan documented.

**Constraint**: No dependency-version changes were made. The user constraint
requires that dependency versions are not changed unless verified in a clean
environment with the full dependency tree installed. The audit environment did
not have `backend/node_modules` installed, so upgrades could not be verified.

**Plan**:
1. Run `npm audit` in a clean environment with `backend/node_modules` installed.
2. Upgrade `node-pg-migrate` (which transitively pulls `glob`→`minimatch`) to a
   version that resolves the advisory.
3. Add `fast-uri` to the tools dependency tree or remove the tool that pulls it.
4. Track in Trivy/npm baselines once the baseline is established.
5. Re-run `npm audit` and the full test suite after upgrades.

## AUD-16 — Proxy trust not enforced

**Finding**: `TRUST_PROXY_HOPS` defaults to 0 and is not enforced in production.
Behind a proxy, every IP-keyed rate limit collapses to the proxy address.

**Status**: Remediated — production start-up warning added.

**Correction**: `backend/src/config/env.ts` now warns at startup when
`NODE_ENV=production` and `TRUST_PROXY_HOPS=0`. The warning informs operators
that IP-keyed rate limits will use the proxy address unless the hop count is
trusted. This is a warning (not a hard failure) so existing deployments are not
broken.

**Verification**: `tsc --noEmit` exit 0; full unit suite 439/439 PASS.

## AUD-17 — Unconditional auxiliary listeners

**Finding**: `server.ts:96-114` always binds ports 3000/8080 on 0.0.0.0 in
addition to the primary PORT (documented Railway workaround).

**Status**: Remediated — auxiliary listeners are now opt-in.

**Correction**: New env var `AUXILIARY_PORTS` (comma-separated port list,
default empty). When set (e.g. `AUXILIARY_PORTS="3000,8080"`), the auxiliary
listeners are bound as before. When unset (default), only the primary PORT is
bound. Existing Railway deployments can restore the old behaviour by setting
`AUXILIARY_PORTS`.

**Verification**: `tsc --noEmit` exit 0; full unit suite 439/439 PASS.

## AUD-18 — Test coverage gaps

**Finding**: No integration files for projects or recurring tasks; no
multi-page pagination test on PostgreSQL; security suite has 6 cases; no tests
for AUD-01/03/04/05 scenarios.

**Status**: Partially remediated — unit tests added for projects and
recurring-tasks DTOs. Integration/multi-page/security tests remain BLOCKED
(no PostgreSQL/Redis).

**Correction**:
- `backend/tests/unit/projects-recurring-dto.test.ts` (NEW) — 7 unit tests
  covering project and recurring-task DTO serialization, including AUD-06
  date formatting in both DTOs.
- Tests for AUD-01/03/04/05 scenarios were added in earlier work
  (`password-reset-durability.test.ts`, `otp-service.test.ts`,
  `reauthentication-limiter.test.ts`, `wallet-sms-contract.test.mjs`).

**Remaining**:
- Integration tests for projects/recurring-tasks require PostgreSQL.
- Multi-page pagination test requires PostgreSQL.
- Security suite expansion requires PostgreSQL/Redis + `ALLOW_DESTRUCTIVE_TESTS`.

**Verification**: `tests/unit/projects-recurring-dto.test.ts` 7/7 PASS; full
unit suite 439/439 PASS; `tsc --noEmit` exit 0.

## AUD-19 — Partial localisation

**Finding**: de/es/fr/tr cover 222/382 keys, ar 358/382. English fallback
exists. Docs state new strings always get Arabic entries (24 missing).

**Status**: Tracked — translation completion is a large effort outside the
scope of targeted remediation.

**Current state**:
- English: 382/382 keys (source language).
- Arabic: 358/382 keys (24 missing).
- German/Spanish/French/Turkish: 222/382 keys (160 missing each).

**Plan**:
1. Complete the 24 missing Arabic keys (highest priority — Arabic is the
   default RTL language).
2. Add a CI guard that fails when new English keys are added without a
   corresponding Arabic entry (preventing further drift).
3. Complete the remaining 160 keys per locale in a follow-up translation
   effort.
4. The `app_localizations.dart` English fallback ensures missing keys display
   in English rather than crashing.

**Constraint**: Completing 160+ translations per locale is outside the scope of
minimal, targeted remediation. The English fallback prevents runtime crashes.

## AUD-20 — Maintainability / portability

**Finding**: Stale dispatcher comment, unused `CORS_ALLOWED_ORIGINS`, unpinned
`axllent/mailpit:latest`, `docs-consistency.test.mjs` builds an invalid Windows
path, setup tooling POSIX-only (not stated in README).

**Status**: Remediated.

**Correction**:
1. **Stale dispatcher comment** (`container.ts`): Updated to reflect the
   durable reset request store (F-06) instead of "never in a persistent email
   queue".
2. **Unused `CORS_ALLOWED_ORIGINS`** (`env.ts`): Removed — the variable was
   defined but never read by any code.
3. **Unpinned `axllent/mailpit:latest`** (`docker-compose.yml`): Pinned to
   `axllent/mailpit:v1.14`.
4. **Invalid Windows path** (`docs-consistency.test.mjs`): Regex updated from
   `/\\/$/` (trailing backslash only) to `/[\\/]$/` (trailing backslash or
   forward slash), so `new URL().pathname` works on Windows where path
   separators are forward slashes.
5. **POSIX-only note** (`README.md`): Added a platform note stating setup and
   script tooling are POSIX-only; Windows users should use WSL2 or a POSIX
   shell.

**Verification**: `tsc --noEmit` exit 0; `docs-consistency.test.mjs` 13/13
PASS; full unit suite 439/439 PASS.

---
*Generated by Arena.ai Agent Mode on branch `arena/1619e266-life-style-app`.*
