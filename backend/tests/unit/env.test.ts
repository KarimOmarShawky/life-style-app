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

  it('rejects local transport and example secrets in production', () => {
    const productionEnv = {
      ...validBaseEnv,
      NODE_ENV: 'production',
      DATABASE_SSL: 'false',
      JWT_ACCESS_SECRET: 'local-dev-jwt-access-secret-at-least-32-chars-long',
      OTP_HMAC_SECRET: 'local-dev-otp-hmac-secret-at-least-32-chars-long'
    };

    expect(() => validateEnv(productionEnv)).toThrowError(/DATABASE_SSL must be enabled/);
    expect(() => validateEnv(productionEnv)).toThrowError(/must not use a known example value/);
  });

  it('rejects CI test credentials when NODE_ENV is production', () => {
    const productionEnv = {
      ...validBaseEnv,
      NODE_ENV: 'production',
      DATABASE_SSL: 'true',
      JWT_ACCESS_SECRET: 'test-secret-at-least-32-characters-long-for-hs256',
      OTP_HMAC_SECRET: 'test-otp-secret-at-least-32-characters-long'
    };

    expect(() => validateEnv(productionEnv)).toThrowError(/known example value/);
  });

  it('rejects a known test value used as the previous production JWT key', () => {
    const productionEnv = {
      ...validBaseEnv,
      NODE_ENV: 'production',
      DATABASE_SSL: 'true',
      JWT_ACCESS_SECRET: 'prod-jwt-secret-generated-by-a-secret-manager-012345',
      JWT_ACCESS_SECRET_PREVIOUS: 'test-secret-at-least-32-characters-long-for-hs256',
      OTP_HMAC_SECRET: 'prod-otp-secret-generated-by-a-secret-manager-012345'
    };

    expect(() => validateEnv(productionEnv)).toThrowError(
      /JWT_ACCESS_SECRET_PREVIOUS must not use a known example value/
    );
  });

  it('accepts production configuration with TLS and non-example secrets', () => {
    const productionEnv = {
      ...validBaseEnv,
      NODE_ENV: 'production',
      DATABASE_SSL: 'true',
      JWT_ACCESS_SECRET: 'prod-jwt-secret-generated-by-a-secret-manager-012345',
      OTP_HMAC_SECRET: 'prod-otp-secret-generated-by-a-secret-manager-012345'
    };

    expect(validateEnv(productionEnv).DATABASE_SSL).toBe(true);
  });

  it('requires the least-privilege PostgreSQL role in production', () => {
    const productionEnv = {
      ...validBaseEnv,
      NODE_ENV: 'production',
      DATABASE_SSL: 'true',
      JWT_ACCESS_SECRET: 'prod-jwt-secret-generated-by-a-secret-manager-012345',
      OTP_HMAC_SECRET: 'prod-otp-secret-generated-by-a-secret-manager-012345',
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/lifestyle_prod'
    };

    expect(() => validateEnv(productionEnv)).toThrowError(/least-privilege lifestyle_app role/);
  });
});
