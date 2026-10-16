#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function newCredentials() {
  return Object.fromEntries(['POSTGRES', 'APP', 'MIGRATOR', 'MAINTENANCE', 'JWT', 'OTP']
    .map((name) => [name, randomBytes(32).toString('hex')]));
}
export function databaseUrl(role, password, host, database = 'lifestyle_dev') {
  const url = new URL(`postgresql://${host}:5432/${database}`);
  url.username = `lifestyle_${role}`;
  url.password = password;
  return url.href;
}
function envText(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
}
export function initializeLocalSetup(directory, acknowledged = false) {
  if (!acknowledged) throw new Error('Fresh-install acknowledgement required');
  if (process.platform === 'win32') throw new Error('POSIX private-file permissions required');
  // Only generate inside a real repository directory, never through a symlink.
  const location = resolve(directory);
  if (realpathSync(location) !== location || !lstatSync(location).isDirectory() || lstatSync(location).isSymbolicLink()) throw new Error('Invalid setup directory');
  for (const base of [location, join(location, 'backend')]) {
    try {
      const stat = lstatSync(base);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid configuration directory');
      if (readdirSync(base).some((name) => name === '.env' || (name.startsWith('.env.') && name !== '.env.example'))) {
        throw new Error('Existing environment configuration requires manual review');
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  const destination = join(location, '.local-setup');
  // Exclusive directory creation: an existing directory/file/symlink always fails.
  // On a later write failure leave this newly created private directory for review;
  // never remove/retry/overwrite configuration automatically.
  mkdirSync(destination, { mode: 0o700 });
  const credentials = newCredentials();
  const project = `lifestyle_local_${randomBytes(12).toString('hex')}`;
  const common = {
    LOCAL_PROJECT_NAME: project,
    LOCAL_POSTGRES_PASSWORD: credentials.POSTGRES,
    LOCAL_APP_PASSWORD: credentials.APP,
    LOCAL_MIGRATOR_PASSWORD: credentials.MIGRATOR,
    LOCAL_MAINTENANCE_PASSWORD: credentials.MAINTENANCE,
    LOCAL_JWT_ACCESS_SECRET: credentials.JWT,
    LOCAL_OTP_HMAC_SECRET: credentials.OTP,
    LOCAL_DATABASE_URL: databaseUrl('app', credentials.APP, 'postgres'),
    LOCAL_DATABASE_MIGRATION_URL: databaseUrl('migrator', credentials.MIGRATOR, 'postgres'),
    LOCAL_DATABASE_MAINTENANCE_URL: databaseUrl('maintenance', credentials.MAINTENANCE, 'postgres')
  };
  writeFileSync(join(destination, 'compose.env'), envText(common), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(destination, 'host.env'), envText({
    NODE_ENV: 'development', PORT: '3000', DATABASE_SSL: 'false',
    DATABASE_URL: databaseUrl('app', credentials.APP, 'localhost'),
    DATABASE_MIGRATION_URL: databaseUrl('migrator', credentials.MIGRATOR, 'localhost'),
    DATABASE_MAINTENANCE_URL: databaseUrl('maintenance', credentials.MAINTENANCE, 'localhost'),
    REDIS_URL: 'redis://localhost:6379', JWT_ACCESS_SECRET: credentials.JWT,
    OTP_HMAC_SECRET: credentials.OTP
  }), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(destination, 'setup.json'), JSON.stringify({
    version: 1, project, scope: 'fresh-local-only'
  }) + '\n', { flag: 'wx', mode: 0o600 });
  return { project }; // Never return or print credentials from the initializer.
}

export function readLocalSetup(directory) {
  const location = resolve(directory);
  if (realpathSync(location) !== location) throw new Error('Canonical setup path required');
  const folder = join(location, '.local-setup');
  if (process.platform === 'win32') throw new Error('POSIX private-file permissions required');
  const folderStat = lstatSync(folder);
  if ((process.getuid && folderStat.uid !== process.getuid()) || !folderStat.isDirectory() || folderStat.isSymbolicLink() || (folderStat.mode & 0o077)) throw new Error('Unsafe setup directory');
  const contents = {};
  for (const name of ['compose.env', 'host.env', 'setup.json']) {
    const file = join(folder, name), stat = lstatSync(file);
    if ((process.getuid && stat.uid !== process.getuid()) || !stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size > 16384) throw new Error('Unsafe setup file');
    contents[name] = readFileSync(file, 'utf8');
  }
  const metadata = JSON.parse(contents['setup.json']);
  const parse = (text) => {
    const values = {};
    for (const line of text.trimEnd().split('\n')) {
      const at = line.indexOf('=');
      const key = line.slice(0, at);
      if (at < 1 || !/^[A-Z_]+$/.test(key) || Object.hasOwn(values, key)) throw new Error('Invalid setup configuration');
      values[key] = line.slice(at + 1);
    }
    return values;
  };
  const compose = parse(contents['compose.env']), host = parse(contents['host.env']);
  const expectedCompose = ['LOCAL_PROJECT_NAME', 'LOCAL_POSTGRES_PASSWORD', 'LOCAL_APP_PASSWORD',
    'LOCAL_MIGRATOR_PASSWORD', 'LOCAL_MAINTENANCE_PASSWORD', 'LOCAL_JWT_ACCESS_SECRET',
    'LOCAL_OTP_HMAC_SECRET', 'LOCAL_DATABASE_URL', 'LOCAL_DATABASE_MIGRATION_URL', 'LOCAL_DATABASE_MAINTENANCE_URL'];
  const expectedHost = ['NODE_ENV', 'PORT', 'DATABASE_SSL', 'DATABASE_URL', 'DATABASE_MIGRATION_URL',
    'DATABASE_MAINTENANCE_URL', 'REDIS_URL', 'JWT_ACCESS_SECRET', 'OTP_HMAC_SECRET'];
  const sameKeys = (value, expected) => Object.keys(value).sort().join() === [...expected].sort().join();
  if (!sameKeys(compose, expectedCompose) || !sameKeys(host, expectedHost) || metadata.version !== 1 ||
      metadata.scope !== 'fresh-local-only' || !/^lifestyle_local_[a-f0-9]{24}$/.test(metadata.project) ||
      compose.LOCAL_PROJECT_NAME !== metadata.project) throw new Error('Invalid setup contract');
  const secrets = ['LOCAL_POSTGRES_PASSWORD', 'LOCAL_APP_PASSWORD', 'LOCAL_MIGRATOR_PASSWORD',
    'LOCAL_MAINTENANCE_PASSWORD', 'LOCAL_JWT_ACCESS_SECRET', 'LOCAL_OTP_HMAC_SECRET'];
  if (secrets.some((key) => !/^[a-f0-9]{64}$/.test(compose[key])) ||
      new Set(secrets.map((key) => compose[key])).size !== secrets.length) throw new Error('Invalid setup credentials');
  for (const [role, key, passwordKey] of [
    ['app', 'DATABASE_URL', 'LOCAL_APP_PASSWORD'],
    ['migrator', 'DATABASE_MIGRATION_URL', 'LOCAL_MIGRATOR_PASSWORD'],
    ['maintenance', 'DATABASE_MAINTENANCE_URL', 'LOCAL_MAINTENANCE_PASSWORD']
  ]) {
    if (compose[`LOCAL_${key}`] !== databaseUrl(role, compose[passwordKey], 'postgres') ||
        host[key] !== databaseUrl(role, compose[passwordKey], 'localhost')) throw new Error('Mismatched setup credentials');
  }
  if (host.JWT_ACCESS_SECRET !== compose.LOCAL_JWT_ACCESS_SECRET || host.OTP_HMAC_SECRET !== compose.LOCAL_OTP_HMAC_SECRET ||
      host.NODE_ENV !== 'development' || host.PORT !== '3000' || host.DATABASE_SSL !== 'false' ||
      host.REDIS_URL !== 'redis://localhost:6379') throw new Error('Invalid local runtime settings');
  return { project: metadata.project, compose, host, envFile: join(folder, 'compose.env') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--fresh-install') throw new Error('Explicit fresh setup required');
    initializeLocalSetup(root, true);
    console.log('PASS: private local configuration generated. No services started, volumes changed or credentials rotated.');
    console.log('Use node scripts/local-stack.mjs --check before --start. Never reuse this process for an existing database.');
  } catch {
    console.error('BLOCKED: fresh setup requires no existing environment/setup files and POSIX private permissions. Nothing existing was overwritten. Review any incomplete private directory manually; secret values are not logged.');
    process.exitCode = 2;
  }
}
