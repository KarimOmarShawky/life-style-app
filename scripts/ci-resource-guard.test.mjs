import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guardCiResources } from './ci-resource-guard.mjs';

function fixture() {
  const ids = ['a'.repeat(64), 'b'.repeat(64)], network = 'c'.repeat(64);
  const env = {
    GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux',
    ALLOW_DESTRUCTIVE_TESTS: 'isolated-resources-only',
    DATABASE_URL: 'postgresql://lifestyle_app@localhost:5432/lifestyle_test',
    DATABASE_MIGRATION_URL: 'postgresql://lifestyle_migrator@localhost:5432/lifestyle_test',
    REDIS_URL: 'redis://localhost:6379/15',
    CI_POSTGRES_CONTAINER: ids[0], CI_REDIS_CONTAINER: ids[1], CI_SERVICE_NETWORK: 'job_network',
    DOCKER_HOST: 'ssh://ambient-override', DOCKER_CONTEXT: 'ambient-context'
  };
  const data = ids.map((Id, index) => ({ Id, State: { Running: true }, Config: {
    Image: index === 0 ? 'postgres:16-alpine' : 'redis:7-alpine', Env: ['POSTGRES_DB=lifestyle_test']
  }, NetworkSettings: { Networks: { job_network: { NetworkID: network } }, Ports: {
    [index === 0 ? '5432/tcp' : '6379/tcp']: [{ HostPort: index === 0 ? '5432' : '6379' }]
  } } }));
  const calls = [];
  const run = (...args) => { calls.push(args); return { status: 0, stdout: JSON.stringify(data) }; };
  return { env, data, calls, run };
}

test('guard pins local inspect and verifies job-owned IDs/network/ports (command spy, no services)', () => {
  const f = fixture(); guardCiResources(f.env, f.run);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0][1], ['--host', 'unix:///var/run/docker.sock', 'inspect', f.env.CI_POSTGRES_CONTAINER, f.env.CI_REDIS_CONTAINER]);
  assert.ok(!f.calls[0][2].env.DOCKER_HOST && !f.calls[0][2].env.DOCKER_CONTEXT);
});
for (const [label, values] of [
  ['ordinary local execution', { GITHUB_ACTIONS: 'false' }],
  ['self-hosted runner', { RUNNER_ENVIRONMENT: 'self-hosted' }],
  ['missing acknowledgement', { ALLOW_DESTRUCTIVE_TESTS: '' }],
  ['development target', { DATABASE_URL: 'postgresql://lifestyle_app@localhost/lifestyle_dev' }],
  ['remote endpoint', { DATABASE_URL: 'postgresql://lifestyle_app@remote/lifestyle_test' }],
  ['Redis zero', { REDIS_URL: 'redis://localhost:6379/0' }],
  ['missing actual service ID', { CI_POSTGRES_CONTAINER: '' }]
]) test(`guard rejects ${label} before Docker inspection`, () => {
  const f = fixture(); assert.throws(() => guardCiResources({ ...f.env, ...values }, f.run)); assert.equal(f.calls.length, 0);
});
for (const label of ['id', 'image', 'network', 'port', 'database', 'stopped']) test(`guard rejects mismatched ${label} without any mutation (spy)`, () => {
  const f = fixture();
  if (label === 'id') f.data[0].Id = 'd'.repeat(64);
  if (label === 'image') f.data[0].Config.Image = 'different-image';
  if (label === 'network') f.data[1].NetworkSettings.Networks.job_network.NetworkID = 'd'.repeat(64);
  if (label === 'port') f.data[0].NetworkSettings.Ports['5432/tcp'][0].HostPort = '5433';
  if (label === 'database') f.data[0].Config.Env = ['POSTGRES_DB=lifestyle_dev'];
  if (label === 'stopped') f.data[0].State.Running = false;
  assert.throws(() => guardCiResources(f.env, f.run)); assert.equal(f.calls.length, 1);
});
test('Docker errors/malformed inspection fail closed; raw metadata is never used as a safe error', () => {
  const f = fixture();
  assert.throws(() => guardCiResources(f.env, () => ({ status: 1, stdout: 'private diagnostic' })));
  assert.throws(() => guardCiResources(f.env, () => ({ status: 0, stdout: '{}' })));
});
test('isolated workflow establishes ownership before bootstrap and never weakens the policy gate', () => {
  const source = readFileSync(new URL('../.github/workflows/isolated-runtime.yml', import.meta.url), 'utf8');
  assert.ok(source.indexOf('node scripts/ci-resource-guard.mjs') < source.indexOf('run: psql'));
  assert.ok(source.indexOf('run: psql') < source.indexOf('npm --prefix backend run migrate:up'));
  assert.ok(source.includes('job.services.postgres.id') && source.includes('job.services.redis.id'));
  assert.ok(!source.includes('continue-on-error: true') && !source.includes('migrate:down') && !source.includes('down -v'));
  assert.ok(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').includes('node scripts/check-forbidden.mjs'));
});
