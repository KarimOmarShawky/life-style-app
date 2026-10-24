# Locked-PDF specification verification — 2026-10-24

**Source of truth:** `/tmp/arena-coding-uploads/LifeStyle-App-Final-Specification (2).pdf`
— *LifeStyle App Final Technical & Product Specification v1.0.1*, 103 pages, P0-locked.
**Branch:** `arena/0a645a6c-life-style-app`.
**Verdict:** the backend implements **all 95 endpoints** in the PDF §14.18
index. The v1 HTTP response envelope is implemented, documented in OpenAPI,
and passes backend unit, integration, and security suites; the Flutter
transport unwraps it for existing feature code. The **whole project is still
not signed off**: 30 additive operations are classified separately, and
Flutter/native, Docker/hosted-CI, device, production, and mobile-to-backend E2E
gates cannot be completed in this sandbox.

## What changed in this verification pass

1. **Production dependency remediation.** Migrated Zod 3 → Zod 4 (`zod@4.6.7`),
   updated validation call sites, and refreshed the lockfile. Production
   `npm audit --omit=dev --audit-level=high` now reports **0 vulnerabilities**
   (`body-parser@2.4.0`, `nodemailer@10.2.1` resolved).
2. **Spec endpoint paths.** Added canonical `GET /day/today`, `GET /day/{date}`
   and `GET /dashboard`, migrated Flutter to these paths, and removed the three
   non-spec plural/overview aliases.
3. **Canonical top-level reminders.** Added `POST /reminders`,
   `PATCH /reminders/{id}` and `DELETE /reminders/{id}` with:
   - `entityType` restricted to user-editable `task`/`event`;
   - owned, non-deleted parent enforcement plus a field-level 400 for a foreign
     or unusable parent;
   - exactly one of `remindAt` or `offsetMinutes`;
   - `offsetMinutes` resolved against the parent's task due date/time or event
     start in the user's timezone;
   - MVP channels `push`/`in_app` only;
   - rejection of times more than one minute in the past;
   - `PATCH`/`DELETE` limited to `source=user`, with `PATCH` also requiring
     `status=pending`, otherwise `409 REMINDER_NOT_EDITABLE`.
4. **OpenAPI and contracts.** Regenerated `docs/api/openapi.yaml`; the YAML now
   parses with `js-yaml`, date patterns are emitted correctly, and generation is
   deterministic. Added an HTTP-boundary success-envelope middleware for JSON
   under `/api/v1` (leaving health, exports, and 204/streaming responses alone),
   with list `meta` as a sibling of `data`. OpenAPI schemas match this contract;
   Flutter unwraps `data` and reconstructs legacy paginated payloads. Aligned
   account deletion scheduling/cancellation HTTP statuses with the PDF. Unit
   coverage verifies wrapping, pagination, no double-wrapping, and exceptions.
5. **Verification tooling.** Fixed two stale helper-suite failures (the removed
   duplicate `docker/docker-compose.yml` and refreshed secret-provenance
   fingerprints), and made `check-dart-syntax.mjs` fall back to parsing **all**
   tracked Dart files when the historical base commit is absent from a shallow
   clone. Secret provenance retains the original/fresh-setup hashes and appends
   dated follow-ups; the removed duplicate Compose records are marked deleted.

## Executed gates

| Gate | Result |
|---|---|
| `npm --prefix backend ci` / forbidden ADR-039 guard | PASS |
| Zod 4 strict typecheck and test typecheck | PASS |
| ESLint + Prettier check | PASS |
| Production build | PASS |
| Production dependency audit | PASS, 0 vulnerabilities |
| OpenAPI generate + deterministic byte comparison | PASS; 125 operations, 0 ordinary-success envelope schema gaps |
| Backend unit suite | PASS after envelope changes, 34 files / **353 tests** |
| Owned disposable PostgreSQL 16.14 / Redis 7.4.6 integration suite | PASS after envelope migration, 21 files / **159 tests** |
| Owned disposable security suite | PASS, 2 files / **6 tests** |
| Script helper/source suite (`node --test scripts/*.test.mjs`) | PASS, **109 tests** |
| Secret detector self-test + current-worktree scan | PASS, 616 files / 0 findings |
| WASM Dart syntax check | PASS, 135 tracked Dart files parsed |
| `git diff --check` | PASS |

Evidence:
- `docs/remediation/evidence/C32.txt` — latest owned PostgreSQL/Redis bootstrap,
  migrations, grant probes, integration and security suite output.
- `docs/remediation/disposable-results.json` — machine-readable PASS summary.
- `docs/remediation/evidence/C12.txt` — Dart syntax-only evidence.

## Endpoint coverage

The 30 remaining additional operations are itemized and classified in
`docs/reports/spec-scope-review-2026-10-24.md`: four deferred ingestion
endpoints and 26 additive extensions. The three compatibility aliases have
been removed after migrating Flutter to the canonical paths. The scope review
recommends excluding ingestion from an MVP-only deployment; those endpoints
remain in the current source pending a staged feature removal.


The PDF §14.18 index was parsed into 95 method/path pairs and compared with the
generated OpenAPI document after normalizing trailing slashes:

- **Spec endpoints:** 95
- **App operations:** 125
- **Missing spec endpoints:** **0**
- **Extra app operations:** 30

The previous six missing operations are now present:
`POST /reminders`, `PATCH /reminders/{id}`, `DELETE /reminders/{id}`,
`GET /day/today`, `GET /day/{date}`, `GET /dashboard`.

The 30 extras consist of four deferred ingestion endpoints and 26 additive
extensions, itemized in the scope review. Some overlap with features the PDF
defers beyond the locked MVP (for example SMS auto-capture/AI-style analysis,
digital-detox/focus-shield work and multiple localization catalogs). They should
be reviewed against the product owner before being treated as in-scope.

## Remaining blockers before full sign-off

1. **Flutter/native execution.** The repository's tracked Dart files pass the
   WASM syntax parser (syntax only). `flutter analyze`, `flutter test`, Android
   build, emulator/device verification, and full app-to-API E2E remain undone:
   Flutter bootstrap could not fetch the Dart SDK from `storage.googleapis.com`.
2. **Scope boundary.** The 30 additive routes are inventoried in the scope
   review, including four deferred ingestion endpoints. They remain present;
   strict MVP-only deployment requires disabling deferred ingestion and
   approving the remaining additive routes as later-phase extensions before
   release.
3. **Infrastructure/release gates.** Docker is not installed, and no hosted
   GitHub Actions run was triggered for this unpushed worktree. Production
   TLS/secrets, backup/restore rehearsal, and SMTP/push-provider delivery need
   the actual deployment target and provider accounts.
4. **History/deployed secrets.** Current-worktree secret scan is clean, but Git
   history, ignored/private files and deployed configuration reuse remain
   outside its scope; rotation/production reuse stays BLOCKED.
5. **Real-device lifecycle.** No signed release APK, emulator/physical-device
   lifecycle test, or end-to-end notification/export/auth flow was run.

## Conclusion

The backend is now **endpoint-complete and locally verified** against the
locked PDF's API index, including the success envelope and owned PostgreSQL/
Redis suites. It is **not yet a whole-project sign-off**: mobile/native
execution, the 33 additive-route disposition, hosted CI/infrastructure,
production/provider checks, secret-history review, and device E2E remain
unverified or blocked as listed above.
