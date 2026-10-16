# Versioned database deployment and recovery

Authoritative DDL: `backend/src/infrastructure/database/postgres/migrations/*.cjs`.
Run as `lifestyle_migrator`, never the runtime role. Health probes and API startup
never create schema. The runtime image includes CommonJS migration files and the
production migration CLI. Production secrets must be supplied by a secret manager;
no production role passwords are supplied by the fresh-local generator.

## Fresh local install
Follow [private fresh-local setup](../development/local-setup.md):
`node scripts/local-setup.mjs --fresh-install`, then
`node scripts/local-stack.mjs --check`, and only after explicit review `--start`.
Do not copy `.env.example` expecting usable passwords; no services are started by
credential generation. The wrapper pins a random independent project namespace,
private env file, root Compose file and local Unix Docker socket.

Fresh PGDATA bootstrap requires environment-supplied credentials/acknowledgement,
refuses existing roles/public objects/non-default user schemas, and creates roles
transactionally. The one-shot migration service gates API/worker startup. Actual SQL/bootstrap/forward/failure/grant probes now execute in a fresh owned
cluster (C17/C32). Docker/Compose and actual legacy deployment/restore rehearsal
remain BLOCKED (C18/C35). Failed PG initialization may leave PGDATA
initialized without retrying its SQL hook: inspect privately, never delete volumes
or repeat startup as an automatic repair. The compatibility Compose file has the
same required parameters and adjusted paths; never invoke it unscoped.

## Existing versioned installation / repeated deploy
1. Take and verify a database backup; test restoration on an isolated copy.
2. Verify the image revision, database identity and migration owner out of band.
3. Stop writes if required by a particular migration's locking/compatibility needs.
4. Run `DATABASE_MIGRATION_URL=<secret> npm --prefix backend run migrate:up`
   from source, or run `npm run migrate:up` inside the image with that environment.
5. Inspect exit status and `pgmigrations`; do not start the new application if it failed.
6. Repeat `migrate:up` safely: node-pg-migrate's history and lock skip applied files.
7. Confirm grants with `has_table_privilege('lifestyle_app','ingest_tokens','DELETE')`.

The forward migration `1792022400000_ingest_delete_grant.cjs` repairs the missing
DELETE permission on existing databases. The previously edited ingest migration
is restored to SELECT/INSERT/UPDATE. No ledger rows or personal data are rewritten.
The grant repair is forward-only: its down handler refuses rather than revoke
possibly pre-existing privileges. CI therefore uses fresh up / repeat up, not a
blind production down. Backward rollback of data migrations is not a recovery plan.

## Legacy installations without migration history
Do **not** blindly run initial CREATE TABLE migrations or forge history. Restore a
copy of the database, compare actual columns, constraints, indexes and grants with
the versioned migrations, then approve and record a matching baseline before adopting
the runner. The historical manual upgrade SQL covers only ingest tokens and optional
timer task, not a complete baseline. A general legacy adoption script remains BLOCKED
pending the actual deployed schema/history; table-name parity is insufficient evidence.

## Failure and recovery
Migration errors propagate and gate deployment. Keep the runner's default migration
lock and transactional behavior. Investigate failures on a restored copy; repair via
a reviewed forward migration, not by editing applied files or deleting user records.
Re-run after fixing the cause. Never disable locks or use force to bypass a failure.
Test fresh, repeat, populated upgrade, interrupted deployment and least-privilege
scenarios in isolated PostgreSQL before production. These scenarios have NOT RUN
in the sandbox (no PostgreSQL/Docker), so compatibility is not certified here.

## Historical defaults and existing credential changes
All 18 historical URI matches are preserved in `docs/remediation/secret-triage.json`.
Their tracked application defaults are now removed without scanner exceptions;
production URI validation still rejects the old public values, including encoded
or query-password forms. A zero-finding current-source scan does not prove absence
of deployed reuse. The public ephemeral CI administrator fixture remains.

The fresh generator/bootstrap is NOT an existing-install upgrade/rotation tool.
Changing environment settings does not change passwords stored in an old PGDATA;
initialization hooks do not rerun for an existing volume. Never attach legacy
volumes to a new namespace or replace working secrets with newly generated ones.
Use the backed-up, coordinated operator plan in `../development/local-setup.md`
for any approved role/client/JWT/OTP change. No live rotation has been performed.

`ensure-env.sh` is configuration-only and never applies migrations. Both Compose
sources retain loopback infrastructure host bindings; runtime networking remains
unverified. Keep existing volumes and data through reviewed forward deployment.
