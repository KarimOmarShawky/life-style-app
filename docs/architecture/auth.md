# Authentication & Identity Architecture (Phase P2)

This document specifies the authoritative design, lifecycle semantics, and security guarantees of the LifeStyle App Authentication and Identity system, strictly adhering to **LifeStyle App — Final Technical & Product Specification v1.0.1 (Sections 6.3, 8.1–8.6, 14.2, 14.3, 16.3, and ADRs 002, 024, 040, 041)**.

---

## 1. Core Principles

1. **Native Client Optimized:** The client is exclusively a native Flutter mobile application.
   - Access tokens are Bearer JWTs stored in secure platform storage (iOS Keychain / Android EncryptedSharedPreferences).
   - Refresh tokens are opaque 256-bit cryptographically random tokens stored in secure platform storage.
   - CSRF protection is omitted as no browser cookies or ambient browser credentials exist.
2. **PostgreSQL Single Source of Truth:**
   - Identity data (`users`), session lifecycles (`auth_sessions`), token lineage (`refresh_tokens`), push notifications bindings (`push_devices`), and financial/domain categorization (`categories`) reside exclusively in PostgreSQL 16.
   - Append-only security tracking is guaranteed via `audit_logs`.
   - Redis is strictly reserved for ephemeral, high-throughput caching: password reset OTP HMACs, rate limiting sliding/fixed windows, and asynchronous BullMQ job state.
3. **No Roles / No RBAC:**
   - Every user is an individual account owner.
   - Authorization is achieved by verifying `session.user_id = sub` and enforcing composite primary/foreign keys (`(id, user_id)`). Unowned resources return `404 Not Found`.

---

## 2. Token Architecture & Lifecycle

### 2.1 Access Tokens (JWT)
- **Algorithm:** Pinned strictly to `HS256`.
- **TTL:** 15 minutes (`ACCESS_TOKEN_TTL_SECONDS = 900`).
- **Signing Key:** `JWT_ACCESS_SECRET` (minimum 32 characters). Overlap rotation supported via `JWT_ACCESS_SECRET_PREVIOUS`.
- **Claims:**
  - `sub`: User ID UUID.
  - `sid`: Session ID UUID (references `auth_sessions.id`).
  - `iss`: Configured issuer (`JWT_ISSUER`, e.g., `lifestyle-api`).
  - `aud`: Configured audience (`JWT_AUDIENCE`, e.g., `lifestyle-client`).
  - `iat`: Epoch timestamp in seconds.
  - `exp`: Epoch timestamp in seconds.
- **Clock Skew Tolerance:** 5 seconds.
- **Verification Distinction:**
  - Token expired with valid signature $\rightarrow$ `401 TOKEN_EXPIRED`.
  - Signature mismatch, malformed payload, or `alg: none` $\rightarrow$ `401 UNAUTHENTICATED`.

### 2.2 Refresh Tokens (Opaque SHA-256)
- **Format:** 256-bit cryptographically secure random bytes (`crypto.randomBytes(32)`), encoded as base64url (43 characters).
- **Storage:** Only the SHA-256 hash (`bytea(32)`) is persisted in `refresh_tokens.token_hash`. Raw tokens exist exclusively in the client device and in transient HTTPS responses.
- **TTL:** Sliding window of 30 days (`now + 30 days`), capped strictly at `session.absolute_expires_at` (90 days maximum from session inception).

### 2.3 Strict Rotation & Reuse Detection (ADR-041)
- **Zero Grace Window:** Rotation is immediate. The previous token is marked `rotated_at = now()` atomically.
- **Reuse Detection Trigger:** If a refresh request presents a token that has already been rotated (`rotated_at IS NOT NULL`):
  1. The entire parent session is immediately revoked (`revoked_reason = 'reuse_detected'`).
  2. All push devices registered under that session are deleted (`DELETE FROM push_devices WHERE session_id = $sid`).
  3. An audit log entry `auth.refresh.reuse_detected` is recorded.
  4. The client receives `401 INVALID_REFRESH_TOKEN` (identical error envelope to prevent oracle attacks).

```
Client                        Backend API                       PostgreSQL
  │                                │                                │
  ├─── POST /auth/refresh ────────>│                                │
  │    (with raw token)            ├── SHA-256(rawToken)            │
  │                                ├── SELECT token + session ─────>│
  │                                │<── token row (rotated_at != null)
  │                                │                                │
  │                                ├── [REUSE DETECTED]             │
  │                                ├── UPDATE auth_sessions ───────>│ (revoked_reason='reuse_detected')
  │                                ├── DELETE push_devices ────────>│
  │                                ├── INSERT audit_logs ──────────>│ (event='auth.refresh.reuse_detected')
  │<── 401 INVALID_REFRESH_TOKEN ──┤                                │
```

---

## 3. Password Policies & Timing Attack Defenses

### 3.1 Password Requirements
Conforming to Section 8.4:
- Length: Minimum 10 characters.
- Byte ceiling: Maximum 72 bytes (UTF-8) to prevent bcrypt truncation vulnerabilities.
- Denylist: Common passwords (e.g. `password123`, `1234567890`) are rejected.
- Mismatch: Password cannot equal the user's email address.
- Hashing: `bcrypt` with configurable cost factor (`BCRYPT_COST`, default 12).

### 3.2 Timing Attack Defense
When a login request presents an unrecognized email address, the backend executes `dummyVerify()`:
- Evaluates `bcrypt.compare()` against a static dummy hash.
- Ensures the response latency for non-existent users is indistinguishable from existing users with invalid passwords.
- Returns identical `401 INVALID_CREDENTIALS` error code.

---

## 4. Password Reset Flow (Section 8.5)

1. **Request:** `POST /api/v1/auth/forgot-password` with `{ email }`.
2. **Indistinguishable Response:** Always returns `202 Accepted` with `{}` regardless of whether the email exists.
3. **Cooldown:** Redis key `pwreset-cd:{userId}` enforces a 60-second cooldown between requests (`SET NX EX 60`).
4. **OTP Generation:** 6 cryptographically random digits (`crypto.randomInt(0, 1_000_000)` zero-padded).
5. **HMAC Storage:** `pwreset:{userId}` in Redis stores `{ codeHmac, attempts: 0 }` with a 15-minute TTL (`EX 900`).
   `codeHmac = HMAC-SHA256(OTP_HMAC_SECRET, userId + ":" + code)`.
6. **Attempt Limit:** Maximum 5 attempts. If exceeded, the Redis key is deleted and code is invalidated.
7. **Single-Use Consumption:** Verification consumes and deletes the key atomically.
8. **Session Revocation:** Resetting the password updates `password_hash`, updates `password_changed_at = now()`, revokes all active sessions for that user (`revoked_reason = 'password_reset'`), and purges push device bindings.

---

## 5. Session Validation & Lifecycle Enforcement

Every authenticated request passes through `authenticate` middleware in strict order:
1. `Authorization: Bearer <jwt>` check.
2. HS256 signature verification and clock tolerance check.
3. Expired tokens mapped to `401 TOKEN_EXPIRED`.
4. PostgreSQL verification: `auth_sessions` joined to `users` where `sid = session.id`, `sub = user.id`, `revoked_at IS NULL`, and `absolute_expires_at > now()`.
5. Lifecycle status check:
   - `active`: Request proceeds.
   - `disabled`: Rejected with `403 ACCOUNT_DISABLED`.
   - `pending_deletion`: Rejected with `403 ACCOUNT_PENDING_DELETION`, **except** on exempt endpoints:
     - `POST /api/v1/auth/logout`
     - `POST /api/v1/auth/refresh`
     - `GET /api/v1/users/me`
     - `DELETE /api/v1/users/me/deletion`
     - `POST /api/v1/users/me/export`
