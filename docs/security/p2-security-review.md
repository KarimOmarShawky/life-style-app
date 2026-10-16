> **Historical report — current-scope correction (2026-10-15).** Results/claims
> below are retained as historical assertions, not tests executed or certified in
> the current remediation. Use `docs/remediation/checks.json` for actual gates.
> The legacy account export is metadata-only (profile, sessions, categories and
> push-device metadata), **not a complete GDPR/data-portability archive**. Database,
> security, Flutter/native and real-device execution remain blocked in this sandbox.

# Phase P2 Security Review & Threat Model

This review assesses the authentication, authorization, session management, and data lifecycle mechanisms implemented in Phase P2 against the LifeStyle App Security Architecture (Spec Section 8 and Section 16).

---

## 1. Threat Modeling & Countermeasures

| Threat | Risk Level | Target | Implemented Countermeasure | Verification Test |
|---|---|---|---|---|
| **Brute-Force & Credential Stuffing** | High | `/auth/login` | 1. Rate limiter: 15 req / 15 min per IP.<br>2. Rate limiter: 5 req / 15 min per (email + IP).<br>3. `bcrypt` cost factor 12. | `auth-security.test.ts` |
| **User Enumeration & Timing Attacks** | Medium | `/auth/login`, `/auth/forgot-password` | 1. `dummyVerify()` executes bcrypt compare against constant hash for unknown emails.<br>2. Error message and status identical (`401 INVALID_CREDENTIALS`).<br>3. Forgot-password returns `202 Accepted` `{}` in all cases. | `auth-security.test.ts` (ratio < 3.5x), `auth-flow.test.ts` |
| **Token Hijacking & Replay** | Critical | Refresh Tokens | 1. Refresh tokens are 256-bit high-entropy random values.<br>2. Stored as SHA-256 hash in PostgreSQL; raw token never persisted.<br>3. Strict single-use rotation with zero grace window.<br>4. Reuse detection immediately revokes whole session and associated push devices (ADR-041). | `auth-flow.test.ts` (AC-AUTH-06, AC-AUTH-07) |
| **JWT Tampering & Algorithm Confusion** | Critical | Access Tokens | 1. Verification strictly pinned to `algorithms: ['HS256']`.<br>2. `alg: none`, invalid signatures, or altered payloads fail verification.<br>3. Mandatory claim verification (`iss`, `aud`, `sub`, `sid`). | `token-service.test.ts` |
| **Password Reset OTP Guessing** | High | `/auth/reset-password` | 1. Code stored as HMAC-SHA256 in Redis (cannot be dumped from raw memory).<br>2. Maximum 5 invalid attempts deletes the code immediately.<br>3. 60-second cooldown per account.<br>4. Single-use atomic consumption. | `otp-service.test.ts` |
| **Unauthorized Data Access / Cross-Tenant Leaks** | Critical | `/users/me/*` | 1. No RBAC; all operations strictly scoped by `user_id` from authenticated token context.<br>2. Push device deletion verifies `id = $1 AND user_id = $2`.<br>3. Unowned resources return `404 Not Found`. | `users-flow.test.ts` |
| **Bcrypt Buffer Overflow / Truncation** | Medium | Registration & Password Changes | Passwords limited to 72 bytes (UTF-8) at validation layer using Zod `Buffer.byteLength(val, 'utf8') <= 72`. | `auth-security.test.ts` |
| **Dormant Session Hijacking** | Medium | `auth_sessions` | Hard 90-day absolute expiration cap enforced in PostgreSQL schema and query logic. Refresh token sliding window cannot extend session beyond absolute expiry. | `auth.service.ts` |
| **Pending Deletion Data Corruption** | Low | Data Mutation | Any mutation while account status is `pending_deletion` is rejected with `403 ACCOUNT_PENDING_DELETION`. Only account recovery, export, and logout are allowed. | `users-flow.test.ts` |

---

## 2. Acceptance Criteria Verification Matrix

| Acceptance Criterion | Description | Status | Evidence |
|---|---|---|---|
| **AC-AUTH-01** | User registration with email, password, displayName, timezone, defaultCurrency returns 201, user DTO, access/refresh tokens. Seeds default categories. Case-insensitive email. | **PASS** | `tests/integration/auth-flow.test.ts` |
| **AC-AUTH-02** | Duplicate registration with identical email (case-insensitive) fails with 409 EMAIL_ALREADY_REGISTERED. | **PASS** | `tests/integration/auth-flow.test.ts` |
| **AC-AUTH-03** | Login with valid credentials returns 200, user DTO, tokens. Bad password or non-existent user returns 401 INVALID_CREDENTIALS. | **PASS** | `tests/integration/auth-flow.test.ts` |
| **AC-AUTH-04** | Login timing similarity for non-existent user vs wrong password via `dummyVerify()`. | **PASS** | `tests/security/auth-security.test.ts` |
| **AC-AUTH-05** | Access token expires in 15 minutes. Expired token returns 401 TOKEN_EXPIRED. | **PASS** | `tests/unit/token-service.test.ts` |
| **AC-AUTH-06** | Valid refresh token rotates: returns new access token and new refresh token. Old token marked rotated. | **PASS** | `tests/integration/auth-flow.test.ts` |
| **AC-AUTH-07** | Refresh token reuse detection: using already-rotated token revokes session, deletes push devices, logs audit event. | **PASS** | `tests/integration/auth-flow.test.ts` |
| **AC-AUTH-08** | Single logout revokes session and push devices. Logout-all revokes all sessions and all push devices. | **PASS** | `tests/integration/auth-flow.test.ts` |
| **AC-AUTH-09** | Forgot password returns 202 indistinguishably. 6-digit OTP stored as HMAC. Resetting password revokes all active sessions. | **PASS** | `tests/integration/auth-flow.test.ts` |
| **AC-AUTH-10** | Session validation middleware checks active/disabled/pending_deletion statuses and enforces route exemptions. | **PASS** | `tests/integration/users-flow.test.ts` |
| **AC-AUTH-11** | User profile update, device registration, deletion scheduling (14-day grace period), cancellation, and GDPR export. | **PASS** | `tests/integration/users-flow.test.ts` |

---

## 3. Residual Risks & Next Steps
- **Push Notification Dispatch:** Push token registration is verified and persisted in `push_devices`. Actual FCM/APNS dispatch via worker will be tested in Phase P3/P10.
- **Background Deletion Worker:** Account deletion scheduling (14-day grace) is verified in DB. The scheduled background cleanup worker is slated for Phase P12 (Maintenance & Operations).
