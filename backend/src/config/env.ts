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

  // Database (PostgreSQL 16) — least-privilege runtime role: lifestyle_app
  DATABASE_URL: z
    .string()
    .url({ message: 'DATABASE_URL must be a valid PostgreSQL connection URL' }),
  DATABASE_MIGRATION_URL: z.string().url().optional(),
  DATABASE_MAINTENANCE_URL: z.string().url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('false'),

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

  // CORS Hardening (Empty by default in MVP for native Flutter mobile client)
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((val) => (val ? val.split(',').map((s) => s.trim()) : [])),

  // Email Infrastructure (Development default: Mailpit SMTP port 1025)
  EMAIL_HOST: z.string().default('localhost'),
  EMAIL_PORT: z.coerce.number().int().positive().default(1025),
  EMAIL_USER: z.string().optional().default(''),
  EMAIL_PASSWORD: z.string().optional().default(''),
  EMAIL_FROM: z.string().email().default('no-reply@lifestyle.app'),

  // Push Notifications (FCM credentials JSON, optional in Phase P1)
  FCM_CREDENTIALS: z.string().optional(),

  // SMS auto-capture fallback (backend-only Gemini). Optional: without a key the
  // fallback is disabled and only the local, on-device parser runs. The key must
  // never be shipped in a mobile build or written to logs.
  SMS_FALLBACK_GEMINI_KEY: z
    .string()
    .min(8, { message: 'SMS_FALLBACK_GEMINI_KEY must be at least 8 characters long' })
    .optional(),
  SMS_FALLBACK_GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  SMS_FALLBACK_TIMEOUT_MS: z.coerce.number().int().positive().max(30000).default(6000)
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

  const databaseUrl = new URL(env.DATABASE_URL);
  if (databaseUrl.username !== 'lifestyle_app' && databaseUrl.username !== 'postgres') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL must use lifestyle_app or postgres in production'
    });
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
  return parsedEnv;
}

export function getEnv(): Env {
  if (!parsedEnv) {
    return validateEnv();
  }
  return parsedEnv;
}
