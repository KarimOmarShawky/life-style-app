# Applying the remediation source patch

This ZIP is a **patch set**, not a complete standalone repository. It contains only
changed/new repository-relative files plus an explicit deletion inventory. Unchanged
files and installed dependencies are intentionally absent.

Base repository: KarimOmarShawky/life-style-app
Base revision: 47cf1fd09540e7bcc8b291d6d9a1559cf0c5f855
Working branch: arena/3f871eac-life-style-app

1. Keep an untouched backup of your checkout and application data. Compare your own
   changes before applying. Do not reset/clean/force-checkout any existing workspace.
2. Use a separate working copy of the exact base revision. Extract the ZIP into a
   staging directory, inspect the manifest, then copy the supplied paths into that
   working copy. Do not blindly overwrite a newer or locally modified repository.
3. Review `docs/remediation/deletions.json`. The obsolete secret-bearing email queue producer, two Dockerfile text
   copies and Flutter-generated plugin registrant are removed. Apply those four
   reviewed deletions manually; extracting ZIP files does not perform deletions.
4. `npm --prefix backend ci`; follow `docs/database/migrations.md` using the migration
   identity, backups and an isolated rehearsal. No user database has been migrated
   or certified here. Do not use volume deletion as a deployment fix.
5. Run all verification gates from `docs/remediation/checks.json`. The included logs
   are evidence for this sandbox only, not proof of your infrastructure or device.
6. Deploy the current-password client and server changes together. Legacy mobile
   requests without proof fail closed. Configure actual SMTP credentials/provider;
   confirm real delivery, retention/purge behavior and least-privilege grants.
7. Preserve the clarified local-only audio/server-upload boundary (see
   `docs/security/local-audio-boundary.md`); complete CI/container scans, Flutter builds, Android signing,
   platform/device verification and remaining findings before production approval.

Digital Detox is explicitly partial on Android, unsupported on other checked-in
platforms, and is not a phone lock. See `docs/mobile/digital-detox.md`.

Artifacts can be regenerated with `python scripts/verify-remediation.py` followed by
`python scripts/package-remediation.py --output /path/to/artifacts`. The latter needs
ReportLab and pypdf in an isolated Python environment, not in application dependencies.
Scratch WASM parser setup is documented by C12; Flutter is still a separate gate.


## Credentials after applying this patch
Do not regenerate credentials for an existing installation. Preserve its config,
project and volumes; review backup/rehearsal/coordinated rotation safeguards in
`docs/development/local-setup.md`. The new SQL bootstrap refuses existing roles;
Docker initialization does not rotate passwords in old PGDATA. Only a confirmed
fresh local install may use `node scripts/local-setup.mjs --fresh-install`, then
`node scripts/local-stack.mjs --check` and an explicitly approved `--start`.
The patch contains no private `.local-setup` or usable template signing secrets.
No real Docker/database or hosted-runner behavior has been certified here.
