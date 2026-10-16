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
