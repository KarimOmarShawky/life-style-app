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
