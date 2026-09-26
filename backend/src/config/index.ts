/**
 * Resolved, validated application configuration.
 *
 * Import `config` anywhere. Do not read `process.env` outside this module:
 * a value read directly has not been validated, typed, or documented.
 */
import { parseEnv, type Env } from './env';

export const config: Env = parseEnv();

export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
export const isDevelopment = config.NODE_ENV === 'development';

/** True when a shared Redis instance is configured. */
export const hasRedis = Boolean(config.REDIS_URL);

/** True when MongoDB is configured. */
export const hasMongo = Boolean(config.MONGODB_URI);

export type { Env };
