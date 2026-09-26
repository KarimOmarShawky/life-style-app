# Environment Configuration Reference

> **Specification Reference:** Section 16.6

The LifeStyle App backend requires strict validation of environment configuration at process boot via Zod (`src/config/env.ts`).

## Complete Environment Variable Matrix

| Variable Name | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | `development` | Runtime environment (`development`, `test`, `production`) |
| `PORT` | Yes | `3000` | HTTP listening port |
| `LOG_LEVEL` | No | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`, `silent`) |
| `TRUST_PROXY_HOPS` | Yes (prod) | `0` | Number of upstream reverse proxy hops for client IP extraction |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string for runtime role (`lifestyle_app`) |
| `DATABASE_MIGRATION_URL` | Migration job | — | PostgreSQL connection string for DDL role (`lifestyle_migrator`) |
| `DATABASE_MAINTENANCE_URL` | Worker purge | — | PostgreSQL connection string for purge role (`lifestyle_maintenance`) |
| `DATABASE_POOL_MAX` | No | `10` | Maximum connections in the `pg.Pool` instance |
| `DATABASE_SSL` | No | `false` | Enable TLS certificate validation for database connections |
| `REDIS_URL` | Yes | — | Redis connection URL (`redis://localhost:6379`) |
| `JWT_ACCESS_SECRET` | Yes | — | HMAC-SHA256 secret key for Access JWTs (minimum 32 characters) |
| `JWT_ACCESS_SECRET_PREVIOUS` | No | — | Optional secondary secret key for seamless key rotation overlap |
| `JWT_ISSUER` | Yes | `lifestyle-api` | JWT issuer claim (`iss`) |
| `JWT_AUDIENCE` | Yes | `lifestyle-client`| JWT audience claim (`aud`) |
| `ACCESS_TOKEN_TTL_SECONDS` | No | `900` | Access token lifespan in seconds (default: 15 minutes) |
| `REFRESH_TOKEN_TTL_DAYS` | No | `30` | Refresh token idle expiration in days |
| `SESSION_ABSOLUTE_TTL_DAYS` | No | `90` | Maximum absolute lifespan of an authentication session |
| `BCRYPT_COST` | No | `12` | Password hashing work factor (default: 12 rounds) |
| `OTP_HMAC_SECRET` | Yes | — | Cryptographic HMAC secret for password-reset verification codes |
| `CORS_ALLOWED_ORIGINS` | No | (empty) | Comma-separated CORS whitelist (empty by default for native app) |
| `EMAIL_HOST` | Yes | `localhost` | SMTP host (Mailpit port 1025 in local dev) |
| `EMAIL_PORT` | Yes | `1025` | SMTP port |
| `EMAIL_FROM` | Yes | `no-reply@lifestyle.app` | Default sender email address |
| `FCM_CREDENTIALS` | P8+ | — | Firebase Cloud Messaging service account credentials |
