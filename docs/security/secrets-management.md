# Secrets Management & Log Redaction

> **Specification Reference:** Section 16.5 & 16.6

## 1. Secrets Handling Policy

1. **Zero Hardcoded Secrets:** No secrets, database passwords, HMAC keys, or tokens are committed to source control.
2. **Minimum Entropy Requirements:**
   * `JWT_ACCESS_SECRET`: Must be at least 32 characters (256-bit entropy).
   * `OTP_HMAC_SECRET`: Must be at least 32 characters.
3. **Database Credentials Isolation:**
   * Production services utilize independent credentials for DDL migrations (`lifestyle_migrator`), API transactions (`lifestyle_app`), and background maintenance (`lifestyle_maintenance`).

---

## 2. Automated Structured Log Redaction (Pino)

All server logging executes through the centralized logger (`src/core/logger/logger.ts`). The following paths are automatically and irreversibly redacted to `[REDACTED]` prior to serialization:

* `authorization` and `headers.authorization`
* `cookie` and `headers.cookie`
* `set-cookie`
* `password`, `*.password`, `newPassword`, `*.newPassword`, `currentPassword`
* `refreshToken`, `*.refreshToken`
* `accessToken`, `*.accessToken`
* `token`, `*.token`
* `code`, `*.code`
* `otp`, `*.otp`
* `pushToken`, `*.pushToken`
* `password_hash`, `*.password_hash`
* `secret`, `*.secret`

Request bodies are not logged by default, and raw note content or task descriptions are never exposed in log output.
