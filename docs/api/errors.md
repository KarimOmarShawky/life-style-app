# Error contract

Every error response has the same shape:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid credentials.",
    "requestId": "9657f9fc-793d-4997-b007-f6af3c1f2a21"
  }
}
```

Validation failures add an `issues` array:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid data.",
    "issues": [
      { "field": "body.password", "message": "password must be at least 12 characters" }
    ],
    "requestId": "..."
  }
}
```

`code` is a stable contract. Branch on it. `message` is for humans and may change
without notice.

## Codes

| Code | HTTP | Meaning | Client should |
|---|---|---|---|
| `VALIDATION_ERROR` | 422 | Input failed validation | Show field errors from `issues` |
| `MALFORMED_JSON` | 400 | Body is not valid JSON | Fix the request; this is a bug |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeds 100 kb | Reduce the payload |
| `UNAUTHORIZED` | 401 | No credentials supplied | Send to sign-in |
| `INVALID_CREDENTIALS` | 401 | Sign-in failed | Show a generic failure message |
| `TOKEN_EXPIRED` | 401 | Access token expired | Refresh once, then retry |
| `TOKEN_INVALID` | 401 | Signature or claims bad | Clear tokens, sign in again |
| `TOKEN_REVOKED` | 401 | Session ended server-side | Clear tokens, sign in again |
| `TOKEN_REUSE_DETECTED` | 401 | A rotated token was replayed | Clear everything, warn the user |
| `ACCOUNT_LOCKED` | 423 | Too many failures | Show the `Retry-After` wait |
| `ACCOUNT_DISABLED` | 403 | Account not active | Direct to support |
| `FORBIDDEN` | 403 | Not allowed | Show a permission message |
| `INSUFFICIENT_PERMISSIONS` | 403 | Role too low | Hide the action |
| `NOT_FOUND` | 404 | Missing, or not yours | Treat as missing |
| `CONFLICT` | 409 | Conflicts with current state | Refresh and retry |
| `ALREADY_EXISTS` | 409 | Duplicate | Show a "taken" message |
| `RATE_LIMITED` | 429 | Too many requests | Back off per `Retry-After` |
| `DATABASE_ERROR` | 500 | Storage failure | Retry later, report the id |
| `SERVICE_UNAVAILABLE` | 503 | Dependency down | Retry with backoff |
| `INTERNAL_ERROR` | 500 | Unexpected | Retry later, report the id |

## Why NOT_FOUND covers two different situations

A resource that does not exist and a resource belonging to another user both
return 404 with the same body. Distinguishing them would let an attacker
enumerate valid ids by watching which status comes back. The audit log records
the real reason, so operators can tell them apart even though callers cannot.

## Operational versus unexpected

`AppError` carries an `isOperational` flag that never reaches the client.

- **Operational**: anticipated. Bad input, wrong password, missing row. Logged at
  `warn`.
- **Non-operational**: a bug or a broken dependency. Logged at `error` with a
  full stack.

Anything unrecognized is treated as non-operational, so a new library error shows
up as a 500 in the logs rather than as an accidental disclosure.

## What never appears in a response

Database passwords, SQL text, stack traces (in production), JWT secrets,
environment variables, internal file paths, constraint names, driver messages.

These are kept in `AppError.metadata`, which is logged and never serialized.
Stripping happens at serialization, so no call site can forget it.

## Using the request id

Every response carries `X-Request-Id`, and error bodies repeat it in
`error.requestId`. Quote it in a bug report; it ties the client-visible failure
to every server log line for that request, across all layers.
