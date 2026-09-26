# API Conventions & Uniform Response Envelopes

> **Specification Reference:** Section 14.1 & 15.1, ADR-028

## 1. Global Conventions

* **Base URL:** `/api/v1` for versioned resource endpoints. Health probes (`/health/*`) remain unversioned.
* **Content Negotiation:** All mutating endpoints (`POST`, `PUT`, `PATCH`) require `Content-Type: application/json`. Non-JSON requests return `415 UNSUPPORTED_MEDIA_TYPE`.
* **Payload Limit:** Maximum JSON body size is 100 KB. Oversized payloads return `413 PAYLOAD_TOO_LARGE`.
* **Request ID:** Every request receives an `X-Request-Id` response header. Clients may send a custom UUID in `X-Request-Id` which will be preserved and bound to all log entries.

---

## 2. Uniform Response Envelopes

### Success Envelope (Single Entity)
```json
{
  "success": true,
  "data": {
    "id": "e604f2f4-7f28-44fa-8c54-7a91176b5093",
    "title": "Complete P1 Foundation",
    "isCompleted": false
  }
}
```

### Success Envelope (Paginated Collection)
```json
{
  "success": true,
  "data": [
    { "id": "uuid-1", "title": "First task" },
    { "id": "uuid-2", "title": "Second task" }
  ],
  "meta": {
    "limit": 25,
    "hasMore": false,
    "nextCursor": null
  }
}
```

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
