#!/usr/bin/env node
// Configuration-only guards. Do not load .env files, contact services or print URLs.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function target(env, name, protocols) {
  let url;
  try { url = new URL(env[name]); } catch { throw new Error(`${name} is missing or invalid`); }
  if (!protocols.includes(url.protocol)) throw new Error(`${name} has an unsupported protocol`);
  return url;
}

export function checkEnvironment(env, mode = 'preflight') {
  if (!['preflight', 'isolated'].includes(mode)) throw new Error('Unknown verification mode');
  if (mode === 'isolated' && env.ALLOW_DESTRUCTIVE_TESTS !== 'isolated-resources-only') {
    throw new Error('Explicit isolated-resource acknowledgement is required');
  }
  const app = target(env, 'DATABASE_URL', ['postgres:', 'postgresql:']);
  const migration = target(env, 'DATABASE_MIGRATION_URL', ['postgres:', 'postgresql:']);
  const redis = target(env, 'REDIS_URL', ['redis:', 'rediss:']);
  if (mode === 'preflight') return;

  if (app.username !== 'lifestyle_app' || migration.username !== 'lifestyle_migrator') {
    throw new Error('Isolated verification requires the application and migration roles');
  }
  if (!/^\/lifestyle_test(?:_[a-z0-9_]+)?$/.test(app.pathname) ||
      !/^\/(?:[1-9]|1[0-5])$/.test(redis.pathname)) {
    throw new Error('Only a test-named database and nonzero Redis database are permitted');
  }
  if (app.hostname !== migration.hostname ||
      (app.port || '5432') !== (migration.port || '5432') ||
      app.pathname !== migration.pathname) {
    throw new Error('Migration and application database identities must match');
  }
  if ([app, migration, redis].some((url) => url.search || url.hash)) {
    throw new Error('Isolated verification does not permit URL query or fragment overrides');
  }
  // Names/acknowledgement are guardrails, NOT evidence of physical isolation.
  // The operator must establish actual disposable-resource ownership out of band.
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  try {
    if (process.argv.length !== 3) throw new Error('Expected exactly one mode argument');
    checkEnvironment(process.env, mode);
    console.log(`PASS: ${mode} configuration guard only; connectivity/isolation proof NOT RUN.`);
  } catch (err) {
    // Only our fixed messages are surfaced; never print the URL parser's error/input.
    console.error(`BLOCKED: ${err.message}. No setup or verification actions were started.`);
    process.exitCode = 2;
  }
}
