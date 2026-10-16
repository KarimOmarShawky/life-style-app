# Owner-approved temporary Android pilot — 2026-10-16

The owner explicitly approved starting a NEW temporary isolated backend. This is
not approval to touch an existing server/database, deploy production or merge main.

## Actual environment and constraints

- Real existing application builder, no mocked auth or synthetic success responses.
  A single pilot listener avoids opening the production entrypoint's auxiliary ports.
- NEW owned PostgreSQL16.14 and Redis7.4.6, authenticated and loopback-only. Exact
  PostgreSQL data directory/PID and Redis PID are checked before bootstrap. Fresh
  least-privilege role bootstrap and versioned forward migrations execute separately;
  API process receives only runtime credentials, never admin/migrator credentials.
- Generated secrets/private PG/Redis data are OUTSIDE Git in an owned 0700 directory
  under /home/user/.local/lifestyle-pilot; private files are 0600. No .env adoption,
  provider credential, user data, purge worker, FLUSHDB or destructive suite is used.
- SMTP explicitly rejects at greeting with 421: no mail bodies accepted/queued/logged.
  Registration/password login do not require SMTP. Password reset mail, real provider
  delivery, AI and Push are NOT available; HTTP 202 is never delivery evidence.
- Only synthetic names, notes and emails, and a unique test-only password. Do not use
  a real password, personal finance records, wallet credentials or personal recordings.
  API is internet-reachable when public HTTPS succeeds; standard application JWT,
  account tenancy, JSON-only boundaries and rate limits are unchanged. Public signup
  is not an invitation-only system. The URL is not an authentication secret.
- TEMPORARY: sandbox/session may stop or be replaced. No duration, durability,
  production SLA or future availability is promised. Do not rely on this storage.
  Old owned fixture directories are retained privately, not bulk deleted or reused.

## Execution and evidence

scripts/run-pilot-environment.py uses externally installed scratch PostgreSQL/psql
and Redis binaries (not new application dependencies), creates its own resources,
checks ownership and readiness, runs the actual application on 0.0.0.0:8787 and
stops only its own child processes on termination. It refuses existing dotenv files.
It is a sandbox pilot launcher, not a supported Windows/production deployment tool.

First preparation attempts safely refused an unsupported pilot database name, a
scratch PostgreSQL build without pgcrypto, and missing bundled runtime-library
aliases. All corresponding owned children stopped. No migration was skipped or
changed to accommodate those prerequisites. The complete PostgreSQL16 scratch build
then executed the unchanged application migrations. Real local HTTP smoke initially
used the wrong response envelope and then tried JSON decoding HTTP204; those harness
errors were corrected against actual controller contracts, not by changing the API.
The final 12-check loopback smoke PASS is separately pilot-smoke.json. Its synthetic
fixtures were confined to the first owned cluster; it was stopped and a NEW fresh
pilot cluster started before the external CI probe. No user data existed there and
no limiter policy/TTL was weakened or cache cleared to make tests pass.

Sandbox outbound policy did not allow verification of its own public HTTPS URL.
Therefore local readiness alone is NOT public/mobile reachability evidence.
The manually dispatched CI pipeline must independently verify public HTTPS with
normal certificate validation and execute real register/login/create/read/cross-user
refusal/non-JSON refusal/delete-only-created-task checks against the EXACT reviewed
sandbox host. It fails closed for other hosts, invalid TLS, unexpected bodies or
any assertion failure. No credentials/tokens/response bodies are logged or saved.
This is external API smoke, NOT Android-device or full-app E2E proof.

The connected APK is compiled only after this probe succeeds. It remains a separate
LifeStyle Validation debug app, not a signed/obfuscated production release. Future
CI debug keys may differ: do not uninstall an existing app to work around a signing
mismatch or assume an upgrade/migration was verified. No phone install is claimed.
