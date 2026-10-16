#!/usr/bin/env node
// Trusted GitHub-hosted job preflight ONLY. No SQL, Redis mutation or Docker lifecycle commands.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkEnvironment } from './check-environment.mjs';

export function guardCiResources(env = process.env, run = spawnSync) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.RUNNER_OS !== 'Linux') throw new Error('Hosted Linux runner required');
  checkEnvironment(env, 'isolated');
  const db = new URL(env.DATABASE_URL), migration = new URL(env.DATABASE_MIGRATION_URL), redis = new URL(env.REDIS_URL);
  if ([db, migration, redis].some((url) => url.hostname !== 'localhost') ||
      (db.port || '5432') !== '5432' || (redis.port || '6379') !== '6379' ||
      db.pathname !== '/lifestyle_test' || redis.pathname !== '/15') throw new Error('Dedicated job targets required');
  const ids = [env.CI_POSTGRES_CONTAINER, env.CI_REDIS_CONTAINER];
  if (ids.some((id) => !/^[a-f0-9]{64}$/.test(id || '')) || new Set(ids).size !== 2 || !env.CI_SERVICE_NETWORK) throw new Error('Actual job service identity required');
  const childEnv = { ...env }; delete childEnv.DOCKER_HOST; delete childEnv.DOCKER_CONTEXT;
  // Pin the hosted runner's local socket; Docker output contains environment secrets, never print it.
  const result = run('docker', ['--host', 'unix:///var/run/docker.sock', 'inspect', ...ids], {
    env: childEnv, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024
  });
  if (result.status !== 0 || result.error) throw new Error('Service inspection failed');
  const containers = JSON.parse(result.stdout);
  if (!Array.isArray(containers) || containers.length !== 2) throw new Error('Invalid service inspection');
  let networkId;
  for (const [index, image, port] of [[0, 'postgres:16-alpine', '5432'], [1, 'redis:7-alpine', '6379']]) {
    const container = containers[index];
    const networks = Object.entries(container.NetworkSettings?.Networks || {});
    const binding = container.NetworkSettings?.Ports?.[`${port}/tcp`];
    if (container.Id !== ids[index] || !container.State?.Running || container.Config?.Image !== image ||
        networks.length !== 1 || !Array.isArray(binding) || !binding.some((item) => item.HostPort === port)) throw new Error('Service identity mismatch');
    const [name, network] = networks[0];
    if (!network.NetworkID || (env.CI_SERVICE_NETWORK !== name && env.CI_SERVICE_NETWORK !== network.NetworkID) ||
        (networkId && networkId !== network.NetworkID)) throw new Error('Dedicated service network mismatch');
    networkId = network.NetworkID;
    if (index === 0 && !container.Config.Env?.includes('POSTGRES_DB=lifestyle_test')) throw new Error('Wrong job database');
  }
  // Context values must come directly from job.services in the reviewed workflow.
  // Environment flags/IDs are not an unforgeable authentication boundary for arbitrary local callers.
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    guardCiResources();
    console.log('PASS: hosted job service IDs, local port bindings, database and shared job network verified before bootstrap/tests. No mutations executed by this preflight.');
  } catch {
    console.error('BLOCKED: dedicated hosted service identity/target verification failed. No bootstrap, migrations or destructive tests authorized by this preflight.');
    process.exitCode = 2;
  }
}
