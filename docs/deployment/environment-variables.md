# Production Environment Variables & Secrets Management

> **Specification Reference:** Section 16.6

## 1. Secrets Management Rules

1. **No Secrets in Source Control:** `.env` is explicitly ignored by Git. `.env.example` contains only non-sensitive templates.
2. **Runtime Secret Injection:** Production secrets must be injected via a cloud secret manager (AWS Secrets Manager, HashiCorp Vault, or Kubernetes Secrets).
3. **Rotation Support:** Access JWT secret verification supports rotation via `JWT_ACCESS_SECRET_PREVIOUS`.
4. **Least-Privilege Database URLs:**
   * `DATABASE_URL` connects as `lifestyle_app` (DML only).
   * `DATABASE_MIGRATION_URL` connects as `lifestyle_migrator` (DDL only).
   * `DATABASE_MAINTENANCE_URL` connects as `lifestyle_maintenance` (retention deletes).

---

## 2. Validation Checklist Before Deployment

Before deploying a container image to staging or production, verify:
- [ ] `NODE_ENV` is set to `production`.
- [ ] `TRUST_PROXY_HOPS` matches the exact number of upstream reverse proxy hops.
- [ ] `DATABASE_SSL` is set to `true`.
- [ ] `JWT_ACCESS_SECRET` is a cryptographically random string of at least 32 characters (256 bits).
- [ ] `OTP_HMAC_SECRET` is a cryptographically random string of at least 32 characters.
- [ ] `CORS_ALLOWED_ORIGINS` is left empty unless explicitly authorized.
- [ ] All database URLs point to the appropriate least-privilege database user.

The backend enforces three production startup invariants: `DATABASE_SSL=true`, a `DATABASE_URL` username of `lifestyle_app`, and JWT/OTP secrets that differ from known local and test example values. These checks fail startup rather than silently accepting a development configuration. Migration and maintenance URLs should be injected only into the processes that require them.
