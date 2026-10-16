#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readLocalSetup } from './local-setup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function localStack(directory, mode = '--check', run = spawnSync, parentEnv = process.env) {
  if (!['--check', '--start'].includes(mode)) throw new Error('Unsupported local stack mode');
  const setup = readLocalSetup(directory);
  const env = Object.fromEntries(Object.entries(parentEnv)
    .filter(([key]) => !key.startsWith('LOCAL_') && !key.startsWith('COMPOSE_')));
  if (env.DOCKER_HOST && !env.DOCKER_HOST.startsWith('unix://')) throw new Error('Local Docker socket required');
  const context = run('docker', ['context', 'inspect', ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []), '--format', '{{.Endpoints.docker.Host}}'], {
    cwd: directory, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024
  });
  if (context.status !== 0 || context.error || !context.stdout.trim().startsWith('unix://')) {
    throw new Error('Local Docker context required');
  }
  const endpoint = env.DOCKER_HOST || context.stdout.trim();
  if (!endpoint.startsWith('unix:///') || /\s/.test(endpoint)) throw new Error('Local Unix socket required');
  // Pin the inspected/explicit local socket for every Compose operation.
  delete env.DOCKER_HOST; delete env.DOCKER_CONTEXT;
  const base = ['--host', endpoint, 'compose', '--project-name', setup.project, '--env-file', setup.envFile,
    '--file', resolve(directory, 'docker-compose.yml')];
  const check = run('docker', [...base, 'config', '--quiet'], {
    cwd: directory, env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024
  });
  if (check.status !== 0 || check.error) throw new Error('Local Compose configuration failed');
  if (mode === '--start') {
    const started = run('docker', [...base, 'up', '--detach', '--build'], {
      cwd: directory, env, encoding: 'utf8', timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024
    });
    if (started.status !== 0 || started.error) throw new Error('Local stack startup request failed');
  }
  // No resolved configuration, Docker output or credentials are returned/logged.
  return { requested: mode, project: setup.project };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3) throw new Error('Unexpected arguments');
    const result = localStack(root, process.argv[2] || '--check');
    console.log(result.requested === '--check'
      ? 'PASS: local Compose configuration accepted. Services were not started; database/device verification NOT RUN.'
      : 'PASS: local startup command completed. This is not end-to-end, migration or health certification; verify privately before use.');
  } catch {
    console.error('BLOCKED: private setup, local Docker context or Compose command failed. No existing settings were overwritten; no volumes were deleted. Inspect diagnostics locally without publishing secrets.');
    process.exitCode = 2;
  }
}
