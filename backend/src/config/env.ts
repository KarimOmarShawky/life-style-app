/**
 * src/config/env.ts
 *
 * Implements Section 16.6: Configuration and secrets management.
 * Validates all required environment variables at process startup using Zod.
 * The process fails fast if any required variable is missing or malformed.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file if present
dotenv.config();

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),
  // AUD-17: auxiliary listeners (Railway workaround) are opt-in. Set to a
  // comma-separated port list (e.g. "3000,8080") to bind them in addition to
  // the primary PORT. Default empty = only the primary port is bound.
  AUXILIARY_PORTS: z
    .string()
    .default('')
    .transform((val) =>
      val
        ? val
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535)
        : []
    ),

  // Database (PostgreSQL 16) — least-privilege runtime role: lifestyle_app
  DATABASE_URL: z
    .string()
    .url({ message: 'DATABASE_URL must be a valid PostgreSQL connection URL' }),
  DATABASE_MIGRATION_URL: z.string().url().optional(),
  DATABASE_MAINTENANCE_URL: z.string().url().optional(),
  // Production always requires the erasure marker. This flag also enables the
  // fail-closed startup guard in non-production restore rehearsals.
  REQUIRE_FINANCIAL_RETIREMENT: z.enum(['true', 'false']).default('false'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Per-statement safety ceiling for every pooled connection (ms).
  // 15s default; raise for deployments with legitimately long
  // statements (large exports, heavy analytics) or lower to fail fast.
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  DATABASE_SSL: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default(false),

  // Temporary / Infrastructure Store (Redis 7)
  REDIS_URL: z.string().url({ message: 'REDIS_URL must be a valid Redis connection URL' }),

  // Access Token (JWT HS256) — Secret must be >= 32 characters (256-bit minimum)
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters long' }),
  JWT_ACCESS_SECRET_PREVIOUS: z.string().min(32).optional(),
  JWT_ISSUER: z.string().default('lifestyle-api'),
  JWT_AUDIENCE: z.string().default('lifestyle-client'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 minutes
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().positive().default(90),
  BCRYPT_COST: z.coerce.number().int().min(4).max(16).default(12),

  // Password Reset OTP Security (HMAC key >= 32 characters)
  OTP_HMAC_SECRET: z
    .string()
    .min(32, { message: 'OTP_HMAC_SECRET must be at least 32 characters long' }),

  // Email Infrastructure (Development default: Mailpit SMTP port 1025)
  EMAIL_HOST: z.string().default('localhost'),
  EMAIL_PORT: z.coerce.number().int().positive().default(1025),
  EMAIL_USER: z.string().optional().default(''),
  EMAIL_PASSWORD: z.string().optional().default(''),
  EMAIL_FROM: z.string().email().default('no-reply@lifestyle.app'),

  // Push Notifications (FCM credentials JSON, optional in Phase P1)
  FCM_CREDENTIALS: z.string().optional(),

  // AI assistant proxy (server-side Gemini). The central key lives only in
  // the deployment environment (e.g. Railway), never in the mobile app.
  // AI stays off unless AI_ENABLED is explicitly 'true' AND a key is set;
  // the /ai endpoints then fail closed with 503 instead of calling out.
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  AI_ENABLED: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default(false),
  // Per-user chat quotas enforced through the shared rate limiter.
  AI_USER_MINUTE_LIMIT: z.coerce.number().int().positive().default(10),
  AI_USER_DAILY_LIMIT: z.coerce.number().int().positive().default(200),
  AI_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(20000)
});

const envSchema = baseEnvSchema.superRefine((env, context) => {
  if (env.NODE_ENV !== 'production') return;

  if (!env.DATABASE_SSL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_SSL'],
      message: 'DATABASE_SSL must be enabled in production'
    });
  }

  const knownJwtExamples = new Set([
    'local-dev-jwt-access-secret-at-least-32-chars-long',
    'test-secret-at-least-32-characters-long-for-hs256'
  ]);
  if (knownJwtExamples.has(env.JWT_ACCESS_SECRET)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_ACCESS_SECRET'],
      message: 'JWT_ACCESS_SECRET must not use a known example value in production'
    });
  }
  if (env.JWT_ACCESS_SECRET_PREVIOUS && knownJwtExamples.has(env.JWT_ACCESS_SECRET_PREVIOUS)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_ACCESS_SECRET_PREVIOUS'],
      message: 'JWT_ACCESS_SECRET_PREVIOUS must not use a known example value in production'
    });
  }

  const knownOtpExamples = new Set([
    'local-dev-otp-hmac-secret-at-least-32-chars-long',
    'test-otp-secret-at-least-32-characters-long'
  ]);
  if (knownOtpExamples.has(env.OTP_HMAC_SECRET)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OTP_HMAC_SECRET'],
      message: 'OTP_HMAC_SECRET must not use a known example value in production'
    });
  }

  // These public repository defaults must not be used as production credentials. Check all
  // configured connections, including optional maintenance/migration URLs.
  const knownDatabaseExamples = new Set(
    ['app', 'migrator', 'maintenance', 'postgres'].map((role) => `${role}_local_pass`)
  );
  for (const name of [
    'DATABASE_URL',
    'DATABASE_MIGRATION_URL',
    'DATABASE_MAINTENANCE_URL'
  ] as const) {
    const value = env[name];
    if (!value) continue;
    let url: URL;
    let password: string;
    let username: string;
    try {
      url = new URL(value);
      password = decodeURIComponent(url.password);
      username = decodeURIComponent(url.username);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: 'Invalid PostgreSQL connection configuration'
      });
      continue;
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: 'A PostgreSQL connection URL is required'
      });
    }
    if (
      [password, ...url.searchParams.getAll('password')].some((candidate) =>
        knownDatabaseExamples.has(candidate)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: 'Known development database passwords must not be used in production'
      });
    }
    // node-postgres query parameters can override URI userinfo (last value wins).
    const effectiveUser = url.searchParams.getAll('user').at(-1) || username;
    if (name === 'DATABASE_URL' && effectiveUser !== 'lifestyle_app') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: 'DATABASE_URL must use lifestyle_app in production'
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env | null = null;

/**
 * Validates environment variables and returns typed configuration object.
 * Fails fast with process exit if configuration is invalid.
 */
export function validateEnv(customSource?: Record<string, string | undefined>): Env {
  const source = customSource ?? process.env;
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    const errorMessage = `🚨 Fatal: Environment configuration validation failed:\n${issues}`;

    if (source.NODE_ENV === 'test' || customSource !== undefined) {
      throw new Error(errorMessage);
    } else {
      console.error(errorMessage);
      process.exit(1);
    }
  }

  parsedEnv = result.data;

  // AUD-16: behind a reverse proxy every IP-keyed rate limit collapses to the
  // proxy address unless the proxy hop count is trusted. Warn (not fail) in
  // production so operators notice before rate limits become useless.
  if (parsedEnv.NODE_ENV === 'production' && parsedEnv.TRUST_PROXY_HOPS === 0) {
    console.warn(
      '⚠️  AUD-16: TRUST_PROXY_HOPS is 0 in production. If the API runs behind ' +
        'a reverse proxy, every IP-keyed rate limit will use the proxy address. ' +
        'Set TRUST_PROXY_HOPS to the number of proxy hops (e.g. 1 for a single proxy).'
    );
  }

  return parsedEnv;
}

export function getEnv(): Env {
  if (!parsedEnv) {
    return validateEnv();
  }
  return parsedEnv;
}
