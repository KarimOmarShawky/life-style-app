# API scope review against the locked v1.0.1 endpoint index

> **Historical snapshot (2026-10-24).** Endpoint counts and dispositions
> describe the tree as it was on that date and are not re-verified by later
> passes. Later corrections live in the dated reports that follow this one.

**Source:** PDF §14.18, complete endpoint index (95 method/path pairs).
**Compared against:** generated `docs/api/openapi.yaml` (125 operations).
**Result:** 95/95 specified operations present; after client migration and alias removal, 30 additional operations remain.

## Disposition

This review separates compatibility/product extensions from features that appear
outside the locked MVP. The three duplicate aliases were removed after migrating
the Flutter client to the canonical paths. Other additional routes remain
callable because several support existing app screens and feature flows; they
are classified as additive extensions, not falsely counted as part of the
95-operation spec. The product decision in this work session is to preserve
these extensions rather than break the existing application. The 95-operation
PDF scope remains independently covered. Deferred ingestion remains classified
as a later-phase feature, not a PDF requirement.

## Deferred ingestion surface — exclude from the locked MVP (4)

The specification defers SMS/email capture and AI-style parsing. These routes
should be disabled for an MVP-only deployment and considered for a later phase:

- `POST /ingest/token`
- `DELETE /ingest/token`
- `POST /ingest/transactions`
- `POST /ingest/sms/analyze`

The implementation still contains these routes and related backend code. A
release configured strictly to the PDF must not expose this surface until the
feature is re-approved and its security/provider review is complete.

## Other additive operations — preserve only as explicitly non-MVP extensions (26)

| Method/path | Classification |
|---|---|
| `DELETE /events/{id}/reminders/{reminderId}` | Parent-scoped convenience alias; canonical unified reminder contract exists. |
| `DELETE /habits/{id}/reminders/{reminderId}` | Parent-scoped convenience alias; canonical unified reminder contract exists. |
| `DELETE /subscriptions/{id}/reminders/{reminderId}` | Parent-scoped convenience alias; canonical unified reminder contract exists. |
| `DELETE /tasks/{id}/reminders/{reminderId}` | Parent-scoped convenience alias; canonical unified reminder contract exists. |
| `DELETE /notes/{id}/links/{linkId}` | Additive link-management operation. |
| `GET /events/agenda` | Convenience agenda projection. |
| `GET /events/conflicts` | Convenience calendar conflict query. |
| `GET /events/{id}/reminders` | Parent-scoped convenience reminder read. |
| `GET /goals/{id}/milestones` | Additive milestone listing; core goal responses already include milestone data. |
| `GET /goals/{id}/milestones/{milestoneId}` | Additive milestone detail. |
| `GET /habits/progress/today` | Convenience daily-progress projection. |
| `GET /habits/{id}/reminders` | Parent-scoped convenience reminder read. |
| `GET /money/budgets/{id}` | Additive individual budget read. |
| `GET /money/categories/{id}` | Additive individual category read. |
| `GET /notes/{id}/links` | Additive link listing. |
| `GET /subscriptions/{id}/reminders` | Parent-scoped convenience reminder read. |
| `GET /tasks/{id}/reminders` | Parent-scoped convenience reminder read. |
| `POST /events/{id}/reminders` | Parent-scoped reminder write alias. |
| `POST /events/{id}/restore` | Extra restore action not in the endpoint index. |
| `POST /goals/{id}/restore` | Extra restore action not in the endpoint index. |
| `POST /habits/{id}/reminders` | Parent-scoped reminder write alias. |
| `POST /habits/{id}/restore` | Extra restore action not in the endpoint index. |
| `POST /notes/{id}/links` | Additive link-management operation. |
| `POST /subscriptions/{id}/reminders` | Parent-scoped reminder write alias. |
| `POST /tasks/{id}/reminders` | Parent-scoped reminder write alias. |
| `POST /users/me/export/archive` | Streaming archive extension; the indexed export contract is `POST /users/me/export`. |

## Release gates still requiring external environment/owner assets

- Flutter `analyze`/`test`, Android build, device/emulator and full app-to-API E2E.
- Docker build/image scan and hosted GitHub Actions on this branch.
- Production TLS, deployment secrets, provider delivery (SMTP/APNs/FCM), and a
  real backup/restore rehearsal.
- Secret-history and deployed-configuration review/rotation; current scanner
  covers only the worktree.

These are not replaced by a local PASS. The current-sandbox Flutter bootstrap
failed because the SDK's Dart archive is hosted at `storage.googleapis.com`,
which is not reachable from this environment. Docker is not installed. No
production/provider credentials or deployment target are attached.
