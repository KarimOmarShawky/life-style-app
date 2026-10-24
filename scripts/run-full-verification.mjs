#!/usr/bin/env node
/**
 * scripts/run-full-verification.mjs
 *
 * One entry point for the full verification matrix the 2026-10-24 audit asked
 * for (its P1 item 7): backend quality/unit/database gates, migrations, the
 * Flutter suite, the Android unit tests, APK verification, dependency and
 * image/filesystem scanning.
 *
 * It is an orchestrator, not a substitute for the gates themselves:
 *
 *   - Every gate runs its real command. Nothing here re-implements a check,
 *     and nothing here relaxes one.
 *   - A gate whose toolchain is absent is reported BLOCKED, never PASS.
 *   - Database and migration steps are refused unless
 *     scripts/check-environment.mjs accepts the environment in `isolated`
 *     mode, so a stray DATABASE_URL can never point this script at real data.
 *   - Exit code 1 = at least one FAIL. Exit code 2 = a gate the operator
 *     marked required was BLOCKED or NOT RUN.
 *
 * Usage:
 *   node scripts/run-full-verification.mjs [--require <gate>] [--skip <gate>]
 *                                          [--json <file>] [--list]
 *
 * Environment (optional, all gates degrade to BLOCKED/NOT RUN without them):
 *   DATABASE_URL, DATABASE_MIGRATION_URL, REDIS_URL   PostgreSQL + Redis targets
 *   ALLOW_DESTRUCTIVE_TESTS=isolated-resources-only   acknowledgement for DB gates
 *   VERIFY_APK_PATH (+ VERIFY_APK_MODE=debug|release) APK to verify
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkEnvironment } from './check-environment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'backend');
const mobile = join(root, 'mobile-app', 'mobile');
const android = join(mobile, 'android');

const SHELL = process.platform === 'win32';
const TIMEOUT_MS = 20 * 60 * 1000;
const MAX_BUFFER = 32 * 1024 * 1024;

function run(command, args, cwd, env = process.env) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    shell: SHELL
  });
  return {
    ok: result.status === 0 && !result.error,
    code: result.status,
    error: result.error?.code ?? null,
    ms: Date.now() - started,
    tail: ((result.stdout || '') + (result.stderr || '')).trim().split('\n').slice(-12).join('\n')
  };
}

/** A tool is present only if it answers; a missing binary is not a failure. */
function hasTool(command, args = ['--version']) {
  const probe = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    shell: SHELL
  });
  return !probe.error && probe.status === 0;
}

/** Every node:test suite in scripts/, so new suites are picked up automatically. */
function testScripts() {
  return readdirSync(join(root, 'scripts'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => join('scripts', name));
}

function npm(args) {
  return { command: 'npm', args, cwd: backend };
}

function databaseGuard() {
  try {
    checkEnvironment(process.env, 'isolated');
    return null;
  } catch (error) {
    return `database guard refused: ${error.message}`;
  }
}

function apkGate() {
  const path = process.env.VERIFY_APK_PATH;
  if (!path || !existsSync(path)) {
    return 'not requested: set VERIFY_APK_PATH to a built APK (and VERIFY_APK_MODE=debug|release)';
  }
  const mode = process.env.VERIFY_APK_MODE || 'debug';
  if (!['debug', 'release'].includes(mode)) return `unsupported VERIFY_APK_MODE: ${mode}`;
  if (!(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT)) {
    return 'Android SDK required (ANDROID_HOME or ANDROID_SDK_ROOT)';
  }
  return null;
}

const GATES = [
  {
    id: 'contracts',
    title: 'Repository contract suites (source-level invariants, no services needed)',
    kind: 'always',
    steps: () => [
      {
        label: 'node --test <every scripts/*.test.mjs>',
        // Discovered, not hard-coded: a new contract suite is picked up
        // automatically. Only *.test.mjs is passed, so helper scripts that
        // expect their own argv are never executed as tests.
        run: () => run('node', ['--test', ...testScripts()], root)
      }
    ]
  },
  {
    id: 'docs',
    title: 'Documentation consistency (paths, canonical routes, historical labelling, search scope)',
    kind: 'always',
    steps: () => [{ label: 'check-docs-consistency', run: () => run('node', ['scripts/check-docs-consistency.mjs'], root) }]
  },
  {
    id: 'backend-quality',
    title: 'Backend quality gates (forbidden deps, format, lint, types, build)',
    kind: 'always',
    steps: () => [
      { label: 'check-forbidden', run: () => run('node', ['scripts/check-forbidden.mjs'], root) },
      { label: 'npm run format:check', run: () => run('npm', ['run', 'format:check'], backend) },
      { label: 'npm run lint', run: () => run('npm', ['run', 'lint'], backend) },
      { label: 'npm run typecheck', run: () => run('npm', ['run', 'typecheck'], backend) },
      { label: 'npm run typecheck:tests', run: () => run('npm', ['run', 'typecheck:tests'], backend) },
      { label: 'npm run build', run: () => run('npm', ['run', 'build'], backend) }
    ]
  },
  {
    id: 'backend-unit',
    title: 'Backend unit tests',
    kind: 'always',
    steps: () => [{ label: 'npm run test:unit', run: () => run('npm', ['run', 'test:unit'], backend) }]
  },
  {
    id: 'migrations',
    title: 'Migrations applied twice (idempotency)',
    kind: 'guarded',
    blocked: databaseGuard,
    blockedHint: 'needs DATABASE_MIGRATION_URL + DATABASE_URL + REDIS_URL and ALLOW_DESTRUCTIVE_TESTS=isolated-resources-only',
    steps: () => [
      { label: 'npm run migrate:up (1)', run: () => run('npm', ['run', 'migrate:up'], backend) },
      { label: 'npm run migrate:up (2)', run: () => run('npm', ['run', 'migrate:up'], backend) }
    ]
  },
  {
    id: 'backend-integration',
    title: 'Backend integration + security suites (PostgreSQL/Redis)',
    kind: 'guarded',
    blocked: databaseGuard,
    blockedHint: 'needs disposable PostgreSQL + Redis targets and the isolated-resources acknowledgement',
    steps: () => [
      { label: 'npm run test:integration', run: () => run('npm', ['run', 'test:integration'], backend) },
      { label: 'npm run test:security', run: () => run('npm', ['run', 'test:security'], backend) }
    ]
  },
  {
    id: 'backend-coverage',
    title: 'Backend coverage floors (vitest thresholds)',
    kind: 'guarded',
    blocked: databaseGuard,
    blockedHint: 'coverage runs the whole suite, so it needs the same disposable targets',
    steps: () => [{ label: 'npm run test:coverage', run: () => run('npm', ['run', 'test:coverage'], backend) }]
  },
  {
    id: 'secrets',
    title: 'Source secret scan (worktree only; detector self-test included)',
    kind: 'tool',
    tool: () =>
      existsSync(join(root, 'tools', 'security', 'node_modules', 'secretlint', 'bin', 'secretlint.js'))
        ? null
        : 'secretlint not installed - run: npm --prefix tools/security ci',
    steps: () => [{ label: 'node scripts/scan-secrets.mjs', run: () => run('node', ['scripts/scan-secrets.mjs'], root) }]
  },
  {
    id: 'audit',
    title: 'Production dependency audit (backend, dev deps excluded)',
    kind: 'always',
    steps: () => [{ label: 'npm audit --omit=dev --audit-level=high', run: () => run('npm', ['audit', '--omit=dev', '--audit-level=high'], backend) }]
  },
  {
    id: 'flutter',
    title: 'Flutter analyze + test suite',
    kind: 'tool',
    tool: () => (hasTool('flutter') ? null : 'Flutter SDK not on PATH'),
    steps: () => [
      { label: 'flutter --version', run: () => run('flutter', ['--version'], mobile) },
      { label: 'flutter pub get', run: () => run('flutter', ['pub', 'get'], mobile) },
      { label: 'flutter analyze', run: () => run('flutter', ['analyze'], mobile) },
      { label: 'flutter test', run: () => run('flutter', ['test'], mobile) }
    ]
  },
  {
    id: 'android',
    title: 'Android JVM unit tests (Kotlin receiver, cipher, bridges)',
    kind: 'tool',
    tool: () => {
      if (!hasTool('java', ['-version'])) return 'Java runtime not on PATH';
      if (!(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT)) {
        return 'Android SDK required (ANDROID_HOME or ANDROID_SDK_ROOT)';
      }
      return null;
    },
    steps: () => [
      {
        label: './gradlew testDebugUnitTest',
        run: () =>
          run(
            process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
            ['testDebugUnitTest'],
            android
          )
      }
    ]
  },
  {
    id: 'apk',
    title: 'APK identity/signature verification (real apksigner)',
    kind: 'tool',
    tool: apkGate,
    steps: () => [
      {
        label: `verify-android-apk ${process.env.VERIFY_APK_MODE || 'debug'}`,
        run: () =>
          run(
            'node',
            ['scripts/verify-android-apk.mjs', process.env.VERIFY_APK_MODE || 'debug', process.env.VERIFY_APK_PATH],
            root
          )
      }
    ]
  },
  {
    id: 'trivy',
    title: 'Trivy filesystem scan (same command CI enforces)',
    kind: 'tool',
    tool: () => (hasTool('trivy') ? null : 'trivy not installed (CI uses aquasecurity/trivy-action)'),
    steps: () => [
      {
        label: 'trivy fs --severity HIGH,CRITICAL',
        run: () =>
          run('trivy', ['fs', '--scanners', 'vuln,secret,misconfig', '--ignore-unfixed', '--severity', 'HIGH,CRITICAL', '--exit-code', '1', '--trivyignores', '.trivyignore', '.'], root)
      }
    ]
  }
];

function parseArgs(argv) {
  const options = { require: new Set(), skip: new Set(), json: null, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--list') options.list = true;
    else if (arg === '--require') options.require.add(argv[index + 1]);
    else if (arg === '--skip') options.skip.add(argv[index + 1]);
    else if (arg === '--json') options.json = argv[index + 1];
    else throw new Error(`Unknown argument: ${arg}`);
    if (arg === '--require' || arg === '--skip' || arg === '--json') index += 1;
  }
  return { options };
}

const USAGE = `Usage: node scripts/run-full-verification.mjs [options]

Options:
  --require <gate>   Fail the run when this gate is BLOCKED or NOT RUN (repeatable).
  --skip <gate>      Skip a gate entirely (repeatable).
  --json <file>      Write the results table as JSON.
  --list             Print the gate ids and exit.
  -h, --help         Show this message.

Gates:
${GATES.map((gate) => `  ${gate.id.padEnd(20)} ${gate.title}`).join('\n')}`;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const { options } = parsed;

  if (options.list) {
    for (const gate of GATES) console.log(`${gate.id.padEnd(20)} ${gate.title}`);
    process.exit(0);
  }

  const unknown = [...options.require, ...options.skip].filter((id) => !GATES.some((gate) => gate.id === id));
  if (unknown.length) {
    console.error(`Unknown gate id(s): ${unknown.join(', ')}`);
    process.exit(2);
  }

  const results = [];
  let failures = 0;

  for (const gate of GATES) {
    if (options.skip.has(gate.id)) {
      results.push({ id: gate.id, status: 'SKIPPED', reason: 'skipped with --skip', steps: [] });
      console.log(`SKIPPED  ${gate.id}`);
      continue;
    }

    const blocked =
      gate.kind === 'guarded' ? gate.blocked() : gate.kind === 'tool' ? gate.tool() : null;
    if (blocked) {
      results.push({ id: gate.id, status: 'BLOCKED', reason: blocked, steps: [] });
      console.log(`BLOCKED  ${gate.id} — ${blocked}`);
      if (gate.blockedHint) console.log(`         ${gate.blockedHint}`);
      continue;
    }

    console.log(`RUNNING  ${gate.id} — ${gate.title}`);
    const steps = [];
    let status = 'PASS';
    for (const step of gate.steps()) {
      let outcome;
      try {
        outcome = step.run();
      } catch (error) {
        outcome = { ok: false, code: null, error: error.message, ms: 0, tail: '' };
      }
      const detail = {
        label: step.label,
        status: outcome.ok ? 'PASS' : 'FAIL',
        ms: outcome.ms,
        exitCode: outcome.code
      };
      steps.push(detail);
      console.log(`  ${detail.status.padEnd(7)} ${step.label} (${(outcome.ms / 1000).toFixed(1)}s)`);
      if (!outcome.ok) {
        status = 'FAIL';
        failures += 1;
        detail.error = outcome.error ? `spawn ${outcome.error}` : `exit ${outcome.code}`;
        console.log(`         ${detail.error}`);
        if (outcome.tail) {
          for (const line of outcome.tail.split('\n')) console.log(`         | ${line}`);
        }
        break;
      }
    }
    results.push({ id: gate.id, status, steps });
    console.log(`${status.padEnd(8)} ${gate.id}`);
  }

  const missing = [];
  for (const id of options.require) {
    const result = results.find((entry) => entry.id === id);
    if (!result || result.status !== 'PASS') missing.push(`${id} (${result ? result.status : 'NOT RUN'})`);
  }

  console.log('\n=== Full verification matrix ===');
  console.log('gate                 status    detail');
  for (const result of results) {
    const detail = result.reason ?? `${result.steps.length} step(s)`;
    console.log(`${result.id.padEnd(21)}${result.status.padEnd(10)}${detail}`);
  }

  if (options.json) {
    writeFileSync(options.json, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
    console.log(`\nWrote ${options.json}`);
  }

  if (failures > 0) {
    console.error(`\nFAIL: ${failures} gate step(s) failed. Fix them before claiming a clean cycle.`);
    process.exit(1);
  }
  if (missing.length > 0) {
    console.error(`\nINCOMPLETE: required gate(s) did not pass: ${missing.join(', ')}.`);
    console.error('A release candidate needs real evidence for these, not a static review.');
    process.exit(2);
  }
  console.log('\nPASS: every gate that could run, passed. Gates reported BLOCKED/NOT RUN remain unverified.');
}
