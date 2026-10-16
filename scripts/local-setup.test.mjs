import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, chmodSync, symlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { initializeLocalSetup, readLocalSetup } from './local-setup.mjs';
import { localStack } from './local-stack.mjs';

const sourceRoot = resolve(import.meta.dirname ?? dirname(fileURLToPath(import.meta.url)), '..');
function workspace(t) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'lifestyle-fresh-test-')));
  t.after(() => rmSync(path, { recursive: true, force: true })); // Only owned scratch data.
  return path;
}
function setup(t) { const path = workspace(t); initializeLocalSetup(path, true); return path; }
function fakeDocker() {
  const calls = [];
  return { calls, run(command, args, options) {
    calls.push({ command, args, options });
    return { status: 0, stdout: args[0] === 'context' ? 'unix:///local-test.sock\n' : '', stderr: '' };
  } };
}

test('fresh setup requires acknowledgement and leaves no files without it', (t) => {
  const path = workspace(t);
  assert.throws(() => initializeLocalSetup(path));
  assert.ok(!existsSync(join(path, '.local-setup')));
});

test('each installation gets six distinct random secrets and an independent private project', (t) => {
  const first = setup(t), second = setup(t);
  const a = readLocalSetup(first), b = readLocalSetup(second);
  assert.ok(a.project !== b.project);
  assert.equal(lstatSync(join(first, '.local-setup')).mode & 0o777, 0o700);
  for (const file of ['compose.env', 'host.env', 'setup.json']) {
    assert.equal(lstatSync(join(first, '.local-setup', file)).mode & 0o777, 0o600);
  }
  for (const key of ['LOCAL_POSTGRES_PASSWORD', 'LOCAL_APP_PASSWORD', 'LOCAL_MIGRATOR_PASSWORD',
    'LOCAL_MAINTENANCE_PASSWORD', 'LOCAL_JWT_ACCESS_SECRET', 'LOCAL_OTP_HMAC_SECRET']) {
    assert.ok(/^[a-f0-9]{64}$/.test(a.compose[key]));
    assert.ok(a.compose[key] !== b.compose[key], 'Installations must not reuse generated credentials');
  }
});

for (const name of ['.env', '.env.local', 'backend/.env', 'backend/.env.test.local']) {
  test(`existing ${name} is never read/overwritten or migrated`, (t) => {
    const path = workspace(t);
    mkdirSync(join(path, 'backend'), { recursive: true });
    const file = join(path, name), original = 'owned existing configuration';
    writeFileSync(file, original);
    assert.throws(() => initializeLocalSetup(path, true));
    assert.ok(readFileSync(file, 'utf8') === original);
    assert.ok(!existsSync(join(path, '.local-setup')));
  });
}

test('reruns preserve every byte; there is no force/regenerate mode', (t) => {
  const path = setup(t), file = join(path, '.local-setup/compose.env'), original = readFileSync(file);
  assert.throws(() => initializeLocalSetup(path, true));
  assert.ok(readFileSync(file).equals(original));
});

test('an incomplete private directory is preserved for manual review', (t) => {
  const path = workspace(t), folder = join(path, '.local-setup');
  mkdirSync(folder, { mode: 0o700 }); writeFileSync(join(folder, 'partial'), 'owned partial bytes');
  assert.throws(() => initializeLocalSetup(path, true));
  assert.ok(readFileSync(join(folder, 'partial'), 'utf8') === 'owned partial bytes');
});

test('symlink targets and noncanonical roots are rejected without touching the target', (t) => {
  const path = workspace(t), target = workspace(t);
  symlinkSync(target, join(path, '.local-setup'), 'dir');
  assert.throws(() => initializeLocalSetup(path, true));
  assert.ok(!existsSync(join(target, 'compose.env')));
  const alias = join(path, 'alias'); symlinkSync(target, alias, 'dir');
  assert.throws(() => initializeLocalSetup(alias, true));
});

test('two processes racing to initialize yield exactly one setup, not a merge/overwrite', async (t) => {
  const path = workspace(t), module = pathToFileURL(join(sourceRoot, 'scripts/local-setup.mjs')).href;
  const code = `import { initializeLocalSetup } from ${JSON.stringify(module)}; try { initializeLocalSetup(process.env.SETUP_TEST_TARGET, true); } catch { process.exitCode = 2; }`;
  const launch = () => new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, SETUP_TEST_TARGET: path }, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.on('error', reject); child.on('exit', (status) => done(status));
  });
  const statuses = await Promise.all([launch(), launch()]);
  assert.deepEqual(statuses.sort(), [0, 2]);
  assert.ok(readLocalSetup(path).project.startsWith('lifestyle_local_'));
});

for (const file of ['compose.env', 'host.env', 'setup.json']) {
  test(`reader rejects public permissions on ${file}`, (t) => {
    const path = setup(t); chmodSync(join(path, '.local-setup', file), 0o644);
    assert.throws(() => readLocalSetup(path));
  });
}

test('reader rejects a symlinked secret file and unexpected/duplicate env fields', (t) => {
  const path = setup(t), file = join(path, '.local-setup/host.env');
  writeFileSync(file, readFileSync(file, 'utf8') + 'NODE_ENV=production\n');
  assert.throws(() => readLocalSetup(path));
  const other = setup(t), secret = join(other, '.local-setup/compose.env');
  rmSync(secret); symlinkSync(file, secret);
  assert.throws(() => readLocalSetup(other));
});

test('reader rejects changes that disconnect role passwords, URI settings or project metadata', (t) => {
  const path = setup(t), file = join(path, '.local-setup/host.env');
  writeFileSync(file, readFileSync(file, 'utf8').replace('@localhost', '@other-host'));
  assert.throws(() => readLocalSetup(path));
  const other = setup(t), metadata = join(other, '.local-setup/setup.json');
  writeFileSync(metadata, JSON.stringify({ version: 1, scope: 'fresh-local-only', project: 'old_project' }));
  assert.throws(() => readLocalSetup(other));
});

test('wrapper fixes project/file arguments and excludes ambient Compose/secret overrides (Docker spy)', (t) => {
  const path = setup(t), docker = fakeDocker(), expected = readLocalSetup(path);
  const result = localStack(path, '--start', docker.run, {
    PATH: process.env.PATH, COMPOSE_PROJECT_NAME: 'old_project', COMPOSE_FILE: 'old.yml', DOCKER_CONTEXT: 'local-selected', LOCAL_APP_PASSWORD: 'ambient-override'
  });
  assert.equal(docker.calls.length, 3);
  assert.ok(!Object.hasOwn(result, 'compose'));
  for (const call of docker.calls) {
    assert.ok(!Object.keys(call.options.env).some((s) => s.startsWith('LOCAL_') || s.startsWith('COMPOSE_')));
    assert.ok(!JSON.stringify(call.args).includes(expected.compose.LOCAL_APP_PASSWORD));
  }
  assert.ok(docker.calls[0].args.includes('local-selected'));
  assert.deepEqual(docker.calls[1].args.slice(0, 3), ['--host', 'unix:///local-test.sock', 'compose']);
  assert.ok(!Object.hasOwn(docker.calls[1].options.env, 'DOCKER_CONTEXT'));
  assert.ok(docker.calls[1].args.includes(expected.project));
  assert.ok(docker.calls[1].args.includes('--quiet'));
  assert.deepEqual(docker.calls[2].args.slice(-3), ['up', '--detach', '--build']);
});

test('default check never starts services; no raw diagnostic output or volume deletion (Docker spy)', (t) => {
  const path = setup(t), docker = fakeDocker();
  localStack(path, '--check', docker.run, {});
  assert.equal(docker.calls.length, 2);
  assert.ok(docker.calls.every((call) => !call.args.includes('up') && !call.args.includes('down')));
  assert.throws(() => localStack(path, '--destroy', docker.run, {}));
});

test('remote Docker endpoint/context is blocked before any Compose action (Docker spy)', (t) => {
  const path = setup(t), docker = fakeDocker();
  assert.throws(() => localStack(path, '--start', docker.run, { DOCKER_HOST: 'ssh://remote' }));
  assert.equal(docker.calls.length, 0);
  assert.throws(() => localStack(path, '--start', () => ({ status: 0, stdout: 'ssh://remote' }), {}));
});

test('failed Compose validation never starts and cannot expose captured secrets (Docker spy)', (t) => {
  const path = setup(t), value = readLocalSetup(path).compose.LOCAL_APP_PASSWORD;
  let calls = 0;
  try {
    localStack(path, '--start', () => (++calls === 1
      ? { status: 0, stdout: 'unix:///local.sock' }
      : { status: 1, stdout: value, stderr: value }), {});
    assert.fail('Expected a controlled failure');
  } catch (err) { assert.ok(!String(err).includes(value)); }
  assert.equal(calls, 2);
});

test('CI writer refuses ordinary local use and generates masked per-job role settings only in runner fixture', (t) => {
  const envFile = join(workspace(t), 'runner-env'); writeFileSync(envFile, 'EXISTING=value\n');
  const script = join(sourceRoot, 'scripts/ci-database-env.mjs');
  const blocked = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false', GITHUB_ENV: envFile } });
  assert.equal(blocked.status, 2); assert.ok(readFileSync(envFile, 'utf8') === 'EXISTING=value\n');
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_ENV: envFile } });
  assert.equal(run.status, 0);
  const text = readFileSync(envFile, 'utf8');
  assert.ok(text.startsWith('EXISTING=value\n'));
  const values = Object.fromEntries(text.trim().split('\n').map((line) => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  const url = new URL(values.DATABASE_URL);
  assert.ok(url.pathname === '/lifestyle_test' && url.password === values.LIFESTYLE_APP_PASSWORD);
  const ordinaryOutput = run.stdout.split('\n').filter((line) => !line.startsWith('::add-mask::')).join('\n');
  assert.ok(!ordinaryOutput.includes(values.LIFESTYLE_APP_PASSWORD));
  assert.ok(run.stdout.includes(`::add-mask::${values.LIFESTYLE_APP_PASSWORD}`));
});

test('fresh SQL/Compose source requires supplied credentials and refuses existing state (not DB execution)', () => {
  const sql = readFileSync(join(sourceRoot, 'backend/src/infrastructure/database/postgres/init-roles.sql'), 'utf8');
  for (const name of ['app_password', 'migrator_password', 'maintenance_password', 'bootstrap_ack']) {
    assert.ok(sql.indexOf(`\\if :{?${name}}`) < sql.indexOf('SELECT set_config'));
  }
  assert.ok(sql.includes('\\set ON_ERROR_STOP on') && sql.includes('Existing application roles found') && sql.includes('Existing public objects found'));
  assert.ok(!sql.includes('ALTER ROLE') && !sql.includes('_local_pass'));
  assert.ok(sql.indexOf('BEGIN;') < sql.indexOf('CREATE ROLE') && sql.trimEnd().endsWith('COMMIT;'));
  const compose = readFileSync(join(sourceRoot, 'docker-compose.yml'), 'utf8');
  assert.ok(!compose.includes('container_name:') && !compose.includes('external:') && !compose.includes('_local_pass'));
  for (const key of ['LOCAL_PROJECT_NAME', 'LOCAL_POSTGRES_PASSWORD', 'LOCAL_APP_PASSWORD', 'LOCAL_MIGRATOR_PASSWORD',
    'LOCAL_MAINTENANCE_PASSWORD', 'LOCAL_JWT_ACCESS_SECRET', 'LOCAL_OTP_HMAC_SECRET', 'LOCAL_DATABASE_URL',
    'LOCAL_DATABASE_MIGRATION_URL', 'LOCAL_DATABASE_MAINTENANCE_URL']) assert.ok(compose.includes('${' + key + ':?'));
});

test('actual local generator CLI prints status only, never generated values', (t) => {
  const path = workspace(t), folder = join(path, 'scripts'); mkdirSync(folder);
  const file = join(folder, 'local-setup.mjs');
  writeFileSync(file, readFileSync(join(sourceRoot, 'scripts/local-setup.mjs')));
  const blocked = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  assert.equal(blocked.status, 2); assert.ok(!existsSync(join(path, '.local-setup')));
  const result = spawnSync(process.execPath, [file, '--fresh-install'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const data = readLocalSetup(path);
  for (const key of ['LOCAL_POSTGRES_PASSWORD', 'LOCAL_APP_PASSWORD', 'LOCAL_MIGRATOR_PASSWORD',
    'LOCAL_MAINTENANCE_PASSWORD', 'LOCAL_JWT_ACCESS_SECRET', 'LOCAL_OTP_HMAC_SECRET']) {
    assert.ok(!(result.stdout + result.stderr).includes(data.compose[key]));
  }
});
