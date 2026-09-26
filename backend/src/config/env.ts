/**
 * Environment loading and validation.
 *
 * Spec section 28: the application must validate required configuration at
 * startup and fail fast when it is missing. Doing this here, once, means the
 * rest of the codebase can treat `config` as a fully-typed, always-valid object
 * and never reach for `process.env` again.
 *
 * Security note: this module never logs a resolved value. Validation failures
 * report the variable NAME and the reason only, never the offending value,
 * because that value is usually the secret itself.
 */
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

loadDotenv({ path: path.resolve(__dirname, '../../../.env') });
loadDotenv({ path: path.resolve(__dirname, '../../.env') });

/** Minimum entropy we accept for a signing secret, in characters. */
const MIN_SECRET_LENGTH = 32;

const secret = (name: string): z.ZodEffects<z.ZodString, string, string> =>
  z
    .string({ required_error: `${name} is required` })
    .min(MIN_SECRET_LENGTH, `${name} must be at least ${MIN_SECRET_LENGTH} characters`)
    .refine((value) => !/^(change-?me|secret|dev|test|password)/i.test(value), {
      message: `${name} looks like a placeholder. Generate one with: openssl rand -base64 48`,
    });

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

const durationSeconds = (fallback: number): z.ZodDefault<z.ZodNumber> =>
  z.coerce.number().int().positive().default(fallback);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_PREFIX: z.string().default('/api/v1'),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

    // --- PostgreSQL: the relational source of truth -------------------------
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgres:// URL'),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

    // --- MongoDB: document-shaped data (notes, audit log) -------------------
    MONGODB_URI: z.string().optional(),
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

    // --- Redis: cache, rate limiting, token denylist ------------------------
    REDIS_URL: z.string().optional(),
    CACHE_DEFAULT_TTL_SECONDS: durationSeconds(300),

    // --- Authentication -----------------------------------------------------
    JWT_SECRET: secret('JWT_SECRET'),
    JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
    JWT_ISSUER: z.string().default('lifestyle-api'),
    JWT_AUDIENCE: z.string().default('lifestyle-app'),
    ACCESS_TOKEN_TTL_SECONDS: durationSeconds(900), // 15 minutes
    REFRESH_TOKEN_TTL_SECONDS: durationSeconds(60 * 60 * 24 * 30), // 30 days
    BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),

    // --- Cookies (spec section 11) -----------------------------------------
    COOKIE_SECRET: z.string().optional(),
    COOKIE_DOMAIN: z.string().optional(),
    REFRESH_COOKIE_NAME: z.string().default('lifestyle_rt'),

    // --- CORS (spec section 18) --------------------------------------------
    CORS_ALLOWED_ORIGINS: csv,

    // --- Rate limiting (spec section 22) -----------------------------------
    RATE_LIMIT_WINDOW_SECONDS: durationSeconds(60),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: durationSeconds(900),
    AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),

    // --- Account protection (spec section 23) ------------------------------
    MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
    ACCOUNT_LOCKOUT_SECONDS: durationSeconds(900),

    // --- Logging (spec section 26) -----------------------------------------
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: z
      .string()
      .optional()
      .transform((value) => value === 'true' || value === '1'),
  })
  .superRefine((value, ctx) => {
    if (value.JWT_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message:
          'JWT_REFRESH_SECRET must differ from JWT_SECRET, otherwise an access token can be replayed as a refresh token',
      });
    }

    if (value.NODE_ENV === 'production') {
      if (!value.MONGODB_URI) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MONGODB_URI'],
          message: 'MONGODB_URI is required in production: notes and the audit log live in MongoDB',
        });
      }
      if (!value.REDIS_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message:
            'REDIS_URL is required in production: rate limiting and the token denylist must be shared across instances',
        });
      }
      if (value.CORS_ALLOWED_ORIGINS.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ALLOWED_ORIGINS'],
          message: 'CORS_ALLOWED_ORIGINS must list explicit origins in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses `process.env`. Throws a human-readable error listing every problem at
 * once, so a misconfigured deployment is fixed in one pass rather than one
 * restart per missing variable.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
