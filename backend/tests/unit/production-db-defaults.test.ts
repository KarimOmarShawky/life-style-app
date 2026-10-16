import { describe, it, expect } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

const fields = ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'DATABASE_MAINTENANCE_URL'] as const;
const production = {
  NODE_ENV: 'production',
  DATABASE_SSL: 'true',
  DATABASE_URL: 'postgresql://lifestyle_app@localhost/lifestyle_prod',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'unit-generated-nonexample-jwt-key-0123456789',
  OTP_HMAC_SECRET: 'unit-generated-nonexample-otp-key-0123456789'
};
function connection(password: string, encoded = false): string {
  const url = new URL(production.DATABASE_URL);
  url.password = encoded
    ? [...password].map((s) => `%${s.charCodeAt(0).toString(16)}`).join('')
    : password;
  return url.href;
}

describe('Known local database defaults never reach production', () => {
  for (const field of fields) {
    for (const role of ['app', 'migrator', 'maintenance', 'postgres']) {
      it(`${field}: rejects the public ${role} default regardless of connection role`, () => {
        expect(() =>
          validateEnv({ ...production, [field]: connection(`${role}_local_pass`) })
        ).toThrow(/development database passwords/);
      });
    }
    it(`${field}: rejects percent-encoded public defaults too`, () => {
      expect(() =>
        validateEnv({ ...production, [field]: connection('app_local_pass', true) })
      ).toThrow(/development database passwords/);
    });
    it(`${field}: non-PostgreSQL and malformed encoded credentials fail with controlled errors`, () => {
      expect(() =>
        validateEnv({ ...production, [field]: 'https://example.test/database' })
      ).toThrow(/PostgreSQL connection/);
      expect(() => validateEnv({ ...production, [field]: connection('%broken') })).toThrow(
        /PostgreSQL connection configuration/
      );
    });
  }
  for (const field of fields) {
    it(`${field}: also rejects a public password supplied through URL query overrides`, () => {
      const url = new URL(production.DATABASE_URL);
      url.searchParams.set('password', 'app_local_pass');
      expect(() => validateEnv({ ...production, [field]: url.href })).toThrow(
        /development database passwords/
      );
    });
  }
  it('does not let query user override the least-privilege runtime role', () => {
    const url = new URL(production.DATABASE_URL);
    url.searchParams.set('user', 'postgres');
    expect(() => validateEnv({ ...production, DATABASE_URL: url.href })).toThrow(
      /must use lifestyle_app/
    );
  });
  for (const mode of ['development', 'test']) {
    it(`preserves the documented ${mode} fixture workflow`, () => {
      expect(
        validateEnv({ ...production, NODE_ENV: mode, DATABASE_URL: connection('app_local_pass') })
          .NODE_ENV
      ).toBe(mode);
    });
  }
  it('preserves non-example and passwordless external secret-provider configurations', () => {
    expect(validateEnv(production).NODE_ENV).toBe('production');
    expect(
      validateEnv({ ...production, DATABASE_URL: connection('externally-provisioned-unit-value') })
        .NODE_ENV
    ).toBe('production');
  });
  it('does not include passwords or connection strings in validation errors', () => {
    const value = connection('maintenance_local_pass');
    try {
      validateEnv({ ...production, DATABASE_MAINTENANCE_URL: value });
      throw new Error('Expected configuration rejection');
    } catch (err) {
      expect(String(err)).toContain('DATABASE_MAINTENANCE_URL');
      expect(String(err)).not.toContain(value);
      expect(String(err)).not.toContain('maintenance_local_pass');
    }
  });
});
