# API Conventions & Uniform Response Envelopes

> **Specification Reference:** Section 14.1 & 15.1, ADR-028

## 1. Global Conventions

* **Base URL:** `/api/v1` for versioned resource endpoints. Health probes (`/health/*`) remain unversioned.
* **Content Negotiation:** All mutating endpoints (`POST`, `PUT`, `PATCH`) require `Content-Type: application/json`. Non-JSON requests return `415 UNSUPPORTED_MEDIA_TYPE`.
* **Payload Limit:** Maximum JSON body size is 100 KB. Oversized payloads return `413 PAYLOAD_TOO_LARGE`.
* **Request ID:** Every request receives an `X-Request-Id` response header. Clients may send a custom UUID in `X-Request-Id` which will be preserved and bound to all log entries.

---

## 2. Response contracts

Ordinary JSON success responses under `/api/v1` use the locked contract
`{ "success": true, "data": ... }`; the HTTP boundary applies the envelope so
controllers can continue returning their domain DTOs. Existing DTO shapes are
preserved inside `data`, including named resources such as
`{ "data": { "task": { "id": "uuid" } } }`. The Flutter transport unwraps `data`
for existing feature code and tolerates raw JSON during rolling upgrades.

- `GET /api/v1/dashboard` returns `data.overview`.
- `GET /api/v1/day/today` and `/api/v1/day/{date}` return `data.day`.
- Paginated lists use `{ "success": true, "data": [...], "meta": { ... } }`;
  `meta` remains a sibling of `data` as required by §15.1. The Flutter client
  reconstructs the legacy `{ data, meta }` object for existing feature code.
- 204 responses have no body. Health probes and account exports are documented
  exceptions; the NDJSON domain archive remains streamed and unwrapped.
- Canonical top-level reminder writes: `POST /api/v1/reminders`,
  `PATCH /api/v1/reminders/{id}` and `DELETE /api/v1/reminders/{id}`.
  Parent-scoped reminder routes remain for existing clients.
- Errors continue using `{ "success": false, "error": ... }`.
- Monetary dashboard/day minor units are integer **strings**, never JSON numbers;
  day subscriptions include `currencyExponent`. Round HALF_UP per currency at
  display conversion, preserving historical ledger values. JPY=0, USD=2, KWD=3.

### Error Envelope
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "requestId": "b3f1c2a0-4592-498c-8f2c-e105e46bfb77",
    "details": [
      {
        "field": "title",
        "code": "TOO_SHORT",
        "message": "Title must be at least 1 character long"
      }
    ]
  }
}
```

* `details` is present only for `VALIDATION_ERROR` responses.
* Error responses NEVER contain stack traces, database column names, raw SQL, or server file paths.

## Sensitive user actions
Account export and deletion scheduling require a current-password JSON proof and
are additionally limited to five attempts per 15 minutes per authenticated user,
shared across metadata export, domain archive and deletion. Missing proof is 400; wrong proof is
403 REAUTHENTICATION_FAILED; exceeding the budget is 429. Clients must be updated
with the server, not given a passwordless compatibility bypass. See
`docs/remediation/sensitive-actions.md`. The deletion grace period is 14 days.

Sensitive export/deletion fail with 503 SERVICE_UNAVAILABLE if the rate-limit
backend is unavailable (before proof verification/action). Quota exhaustion remains
429. User responses carry Cache-Control: no-store; this is not retroactive erasure
of prior caches. General endpoint outage policy is unchanged.


### Additive NDJSON domain archive
`POST /users/me/export/archive` shares the same proof/security controls but returns
an attachment, not the ordinary JSON success envelope. Verify its versioned manifest,
counts, exact UTF-8 byte count/hash and mandatory final completion footer; an early
HTTP 200 or EOF is not success. Mid-stream errors terminate without a footer/error
envelope. The legacy metadata route keeps its shape with an explicit 1000-row list
limit/413 overflow. See `account-archive.md`; mobile secure-file integration and
actual PostgreSQL/proxy behavior remain separate incomplete/unverified work.
