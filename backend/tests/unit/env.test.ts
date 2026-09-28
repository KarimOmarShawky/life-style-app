/**
 * tests/unit/env.test.ts
 *
 * Verifies Section 16.6: Environment schema validation and fail-fast behavior.
 */

import { describe, it, expect } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

describe('Environment Configuration Validation (Spec §16.6)', () => {
  const validBaseEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://lifestyle_app:pass@localhost:5432/lifestyle_test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a-super-secret-jwt-key-with-at-least-32-chars',
    OTP_HMAC_SECRET: 'a-super-secret-otp-hmac-key-with-at-least-32-chars'
  };

  it('validates and parses a fully compliant environment configuration', () => {
    const config = validateEnv(validBaseEnv);
    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_POOL_MAX).toBe(10);
    expect(config.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(config.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(config.BCRYPT_COST).toBe(12);
  });

  it('fails fast when DATABASE_URL is missing or invalid URL', () => {
    const invalidEnv = { ...validBaseEnv, DATABASE_URL: 'not-a-valid-url' };
    expect(() => validateEnv(invalidEnv)).toThrowError(
      /DATABASE_URL must be a valid PostgreSQL connection URL/
    );
  });

  it('fails fast when JWT_ACCESS_SECRET is shorter than 32 characters', () => {
    const invalidEnv = { ...validBaseEnv, JWT_ACCESS_SECRET: 'short-secret' };
    expect(() => validateEnv(invalidEnv)).toThrowError(
      /JWT_ACCESS_SECRET must be at least 32 characters long/
    );
  });

  it('fails fast when OTP_HMAC_SECRET is shorter than 32 characters', () => {
    const invalidEnv = { ...validBaseEnv, OTP_HMAC_SECRET: 'too-short' };
    expect(() => validateEnv(invalidEnv)).toThrowError(
      /OTP_HMAC_SECRET must be at least 32 characters long/
    );
  });

  it('fails fast when REDIS_URL is invalid', () => {
    const invalidEnv = { ...validBaseEnv, REDIS_URL: 'not-a-url' };
    expect(() => validateEnv(invalidEnv)).toThrowError(
      /REDIS_URL must be a valid Redis connection URL/
    );
  });
});
