# Production Hardening Runbook (P13)

This runbook is limited to the repository's existing API/worker container topology. It does not select a cloud vendor or add a deployment platform.

## Fail-fast production configuration

When `NODE_ENV=production`, backend configuration now requires:

- `DATABASE_SSL=true` (certificate verification remains enabled by the PostgreSQL pool).
- Values for `JWT_ACCESS_SECRET` and `OTP_HMAC_SECRET` that do not match known development or test examples.
- `DATABASE_URL` using the documented least-privilege `lifestyle_app` role.

Use a managed secret store or an equivalent runtime secret injector. Never reuse values from `.env.example` or `docker-compose.yml`. Keep migration and maintenance connections separate from the API role. Do not pass production secrets as Docker build arguments or bake them into the image.

Recommended production environment also sets `TRUST_PROXY_HOPS` to the exact trusted proxy count, uses a TLS-terminating edge, and supplies a real SMTP/FCM integration only where configured by the deployment owner. The native client must be built with an HTTPS `API_BASE_URL`.

## Container and shutdown controls

- The multi-stage image uses the Node.js 24 Alpine runtime, ships production dependencies and compiled output only, and runs as the unprivileged `node` user.
- Root `.dockerignore` excludes local environment files, dependency directories, tests, mobile sources, and documentation from the build context.
- The image liveness check uses Node's built-in fetch and does not add a utility package to the runtime image.
- API shutdown receives `SIGTERM`; allow at least 35 seconds for the documented 30-second drain window before force termination.
- The readiness endpoint must be used for traffic admission; liveness only checks process responsiveness.
- PostgreSQL backups, Redis recovery, TLS certificates, secret rotation, and infrastructure alerts remain responsibilities of the deployment environment. Redis is disposable infrastructure state, never the business-data backup source.

## Release gate

Before production promotion:

1. Run all required GitHub Actions gates, including forbidden-dependency scan, OpenAPI drift, migrations, backend security/integration tests, Flutter analysis, and Flutter tests.
2. Review `npm audit` output and the resolved Flutter dependencies.
3. Run migrations with the migration role in a controlled deployment step; do not run migrations as the API process.
4. Verify readiness/liveness probes and SIGTERM draining in the target environment.
5. Confirm PostgreSQL TLS certificate validation and backup restore procedures.
6. Build/sign and exercise iOS/Android artifacts using the real platform signing configuration and staging API.
7. Roll out gradually and watch request errors, readiness failures, database pool health, Redis connectivity, and worker shutdown logs.

No automatic production deploy is configured because the specification and repository do not identify a deployment provider, environment, or release approval policy.
