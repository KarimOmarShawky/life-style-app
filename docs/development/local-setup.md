# Private credentials for a fresh local installation

## Scope and verification

This is an opt-in **fresh local installation**, not an upgrade, production secret
manager or password-rotation tool. Node 22+ and POSIX private-file permissions are
required; the helper refuses Windows rather than claim equivalent ACL protection.
Docker Compose v2 and PostgreSQL/psql 16+ are required for the proposed stack.
Source/helper tests PASS; actual Compose/SQL/migration/service execution is BLOCKED
in this sandbox because Docker/PostgreSQL are absent. Hosted CI has NOT RUN.

## Before generating anything

Confirm this checkout is for a genuinely new installation, with no existing data
or infrastructure to adopt. Merely lacking an .env file does not prove that.
Back up existing installations instead and use the upgrade section below. The helper
refuses root/backend `.env` and `.env.*` files except `.env.example`, symlinked or
noncanonical paths, and any pre-existing `.local-setup` file/directory/symlink.
There is no force, overwrite, cleanup, import or regeneration switch.

From repository root, only after confirming the fresh-install scope:

```bash
node scripts/local-setup.mjs --fresh-install
# Configuration only: no Docker command, migration or password rotation.
node scripts/local-stack.mjs --check
# Only if local validation succeeds and you explicitly want to create the new stack:
node scripts/local-stack.mjs --start
```

The first command generates six independent 32-byte cryptographic random values:
PostgreSQL administrator, runtime, migration and maintenance passwords plus JWT and
OTP keys. It writes only the ignored `.local-setup/` directory (0700), with exclusive
0600 `compose.env`, `host.env` and `setup.json` files. Credentials are not printed.
If a write fails, the new incomplete private directory is left for manual review;
no directory or previous configuration is deleted or overwritten. Reruns refuse.

The loader verifies owner/private modes, regular nonsymlink files, expected schema,
unique 64-hex credentials, local targets and matching role/URI/signing settings.
`compose.env` supplies the container network configuration; `host.env` supplies
matching localhost settings for a trusted host-side environment loader. Do not
paste, cat, upload or commit either file. Copying `.env.example` alone intentionally
does not provide passwords or usable JWT/OTP keys. Never disable authentication to
make the template work. Do not use the generated development database for tests.

## Namespace and startup safeguards

Each generated configuration has an independent random Compose project namespace.
Both Compose sources require its generated values and have no global container names.
The wrapper pins the root Compose file, explicit private env file, project and local
Unix Docker socket; it strips ambient `COMPOSE_*`/`LOCAL_*` overrides and rejects
nonlocal Docker endpoints/contexts. It captures and suppresses raw Docker output
because resolved settings/diagnostics can contain secrets. A port collision must
be investigated, not "fixed" by stopping/deleting an old stack or its volumes.

The default `--check` requests quiet configuration validation only. `--start`
requests detached build/start, not health, migration or application certification.
There is no down/delete operation. Do not use unscoped legacy Compose commands for
logs/stop/restart: an operator must explicitly use the reviewed generated project,
root file, private env file and same local Docker endpoint. Never publish raw
`docker compose config`, container inspect, database connection or startup logs.

PostgreSQL's fresh-PGDATA hook uses required process environment variables, a fresh
acknowledgement and one transaction; it refuses existing application roles, public
objects or additional non-system schemas. It creates three least-privilege roles;
there is no existing-role alteration. A missing variable fails before secret SQL
interpolation. The one-shot forward migration service must succeed before API and
worker startup. These are source safeguards, not proof of resource ownership or
successful runtime behavior. Public database/Redis/mail host ports remain loopback
bound; the existing API publishing policy is unchanged.

On first-init failure, PostgreSQL can leave an initialized PGDATA for which entrypoint
SQL will not run again automatically. Stop and inspect the exact new installation
privately; do not repeatedly start the application expecting bootstrap to retry.
Do not delete volumes or remove the private directory as an automatic repair. A
reviewed repair/reinitialization plan needs confirmed ownership, backup/restore
checks and explicit approval. Preserve failure evidence without secret values.

## Existing installations and credential rotation

**Do not run the fresh generator/bootstrap to upgrade or rotate an existing stack.**
Changing a Compose environment variable does not change a password in an existing
PostgreSQL data volume. Its initialization SQL runs only for fresh PGDATA, and now
refuses existing roles when explicitly invoked. Do not attach an old volume to a
new generated namespace or copy new passwords over old settings.

1. Identify the actual project, endpoints, roles, migration history and all clients
   (API, worker, migrator, maintenance). Preserve current working configuration.
2. Take and verify database/configuration backups and rehearse restoration and the
   proposed forward migration/credential plan on an isolated copy.
3. If rotation is needed, have an authorized operator provision secrets and review
   an explicit coordinated database-role/client update, outage/connection-drain
   strategy, rollback and verification plan. No generic ALTER ROLE command or
   automatic rotation is supplied by this helper.
4. Changing JWT/OTP keys also affects sessions and pending reset verification;
   review these effects and supported previous-key handling before any change.
5. Check each role's connection/grants, migration state, health and application
   flows before approval. Keep old data/volumes; see `../database/migrations.md`.

These operator actions have NOT RUN here; deployed credential reuse/rotation is
BLOCKED, irrespective of the clean current-source URI detector result.

## Storage and CI limitations

These are plaintext local files protected by filesystem permissions, not encrypted
or managed production secrets. Same-user/privileged operators, Docker inspection,
backups and compromised processes can expose values; the helper is not a defense
against those actors. The source packager refuses private env/setup paths even if
force-added to Git. Source scanning does not inspect these ignored private files.

CI's separate `ci-database-env.mjs` generates per-job application-role/JWT/OTP
credentials, registers GitHub masking directives before appending to the existing
runner environment file, and never executes database commands. Do not run it as a
local setup command: masking directives contain values for the trusted runner to
consume. The `GITHUB_ACTIONS` flag is a context check, not an authentication boundary.
The public ephemeral CI administrator fixture remains; not all CI fixtures have been
eliminated. Local runner-file tests are not hosted-runner, isolation or masking proof.
