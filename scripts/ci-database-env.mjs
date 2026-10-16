#!/usr/bin/env node
// GitHub Actions only: new isolated job credentials, never local configuration.
import { appendFileSync, lstatSync } from 'node:fs';
import { newCredentials, databaseUrl } from './local-setup.mjs';

try {
  if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_ENV) throw new Error('CI environment required');
  const stat = lstatSync(process.env.GITHUB_ENV);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Runner environment file required');
  const values = newCredentials();
  const entries = {
    LIFESTYLE_APP_PASSWORD: values.APP,
    LIFESTYLE_MIGRATOR_PASSWORD: values.MIGRATOR,
    LIFESTYLE_MAINTENANCE_PASSWORD: values.MAINTENANCE,
    DATABASE_URL: databaseUrl('app', values.APP, 'localhost', 'lifestyle_test'),
    DATABASE_MIGRATION_URL: databaseUrl('migrator', values.MIGRATOR, 'localhost', 'lifestyle_test'),
    JWT_ACCESS_SECRET: values.JWT, OTP_HMAC_SECRET: values.OTP
  };
  // Runner control protocol: GitHub consumes these as masking directives, not
  // ordinary secret output. There is no such output in the local generator.
  for (const value of [...Object.values(values), ...Object.values(entries)]) {
    process.stdout.write(`::add-mask::${value}\n`);
  }
  appendFileSync(process.env.GITHUB_ENV,
    Object.entries(entries).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  console.log('PASS: ephemeral CI role environment registered with runner masking. No database commands executed.');
} catch {
  console.error('BLOCKED: trusted runner environment required; credentials not printed as ordinary output.');
  process.exitCode = 2;
}
