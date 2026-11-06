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
5. **Retired SMS fallback:** This release no longer runs wallet SMS analysis and does not require its former provider settings. Remove obsolete secrets through the deployment secret manager; do not copy them to client builds.

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
- [ ] `AUXILIARY_PORTS` is set (e.g. `"3000,8080"`) if the deployment expects auxiliary listeners, or left unset if not.

The backend enforces three production startup invariants: `DATABASE_SSL=true`, a `DATABASE_URL` username of `lifestyle_app`, and JWT/OTP secrets that differ from known local and test example values. These checks fail startup rather than silently accepting a development configuration. Migration and maintenance URLs should be injected only into the processes that require them.

---

## 3. Retired SMS fallback

The wallet and SMS fallback are retired. No SMS provider or Gemini fallback is configured or called by the updated backend. Older deployed versions must be drained separately.

---

## 4. Process listeners (audit P2-02, documented 2026-10; updated 2026-11 for AUD-17)

The API process always binds the primary listener on `PORT`. Auxiliary
listeners are **opt-in** via the `AUXILIARY_PORTS` environment variable.

| Variable | Required | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `AUXILIARY_PORTS` | No | *(unset)* | Comma-separated list of extra ports the API binds in addition to `PORT`. Each port serves the same app. |

When `AUXILIARY_PORTS` is set (e.g. `AUXILIARY_PORTS="3000,8080"`), the API
binds each listed port as an auxiliary listener, provided it differs from
`PORT`. All listeners share the same app instance and are closed together
during graceful shutdown.

**Migration note (AUD-17):** Prior to AUD-17, auxiliary listeners on 3000 and
8080 were bound **unconditionally** (a Railway workaround). That exposed extra
ports on `0.0.0.0` even when the deployment target did not need them. The
behaviour was changed to opt-in. **Deployments that relied on port 8080 (or
3000) must now set `AUXILIARY_PORTS` explicitly** — without it, the auxiliary
listeners are not started and those ports become unreachable.

If a deployment target does not need auxiliary listeners, leave `AUXILIARY_PORTS`
unset.