# Standard Error Codes & Handling Contract

> **Specification Reference:** Section 15.4

The LifeStyle API enforces a predictable catalog of machine-readable error codes:

| HTTP Status | Error Code | Description / Client Guidance |
| :---: | :--- | :--- |
| **400** | `VALIDATION_ERROR` | Request body, query parameters, or URL path parameters failed Zod validation. Details array contains field-specific errors. |
| **400** | `INVALID_OR_EXPIRED_CODE` | Password-reset 6-digit verification code is invalid, expired, or exceeded attempts. |
| **401** | `UNAUTHENTICATED` | Missing or invalid Access Token, or the underlying session has been revoked. |
| **401** | `TOKEN_EXPIRED` | Access Token has expired. Client should invoke token refresh endpoint once. |
| **401** | `INVALID_CREDENTIALS` | Invalid email or password submitted during login. |
| **401** | `INVALID_REFRESH_TOKEN` | Refresh token is unknown, expired, revoked, or has been reused. Client must wipe credentials and prompt user to re-authenticate. |
| **403** | `ACCOUNT_DISABLED` | Account has been disabled by an administrator. |
| **403** | `ACCOUNT_PENDING_DELETION` | Account is within the 14-day deletion grace window. |
| **403** | `FORBIDDEN` | Reserved for future authorization checks. |
| **404** | `NOT_FOUND` | Resource does not exist OR is not owned by the authenticated user (ADR-038). |
| **409** | `CONFLICT` | Generic state or database uniqueness constraint conflict. |
| **409** | `EMAIL_ALREADY_REGISTERED` | User registration attempted with an already existing email address. |
| **409** | `VERSION_CONFLICT` | Optimistic concurrency conflict; submitted version does not match current state. |
| **409** | `TIMER_ALREADY_RUNNING` | Another timer session is already active for this user. |
| **409** | `TIMER_NOT_RUNNING` | Attempted to stop a timer when no active session exists. |
| **409** | `IDEMPOTENCY_KEY_REUSED` | Idempotency key already submitted with different transaction parameters. |
| **413** | `PAYLOAD_TOO_LARGE` | JSON request payload exceeds maximum size limit of 100 KB. |
| **415** | `UNSUPPORTED_MEDIA_TYPE` | Mutating request sent with missing or non-JSON Content-Type. |
| **429** | `RATE_LIMITED` | Rate limit exceeded. Response includes `Retry-After` header. |
| **500** | `INTERNAL_ERROR` | Unexpected server condition. Technical details logged internally; masked to client. |
| **503** | `SERVICE_UNAVAILABLE` | Database deadlock/timeout or dependency connectivity degradation. Client should retry with exponential backoff. |
