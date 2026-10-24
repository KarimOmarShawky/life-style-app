import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkEnvironment } from './check-environment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = {
  DATABASE_URL: 'postgresql://lifestyle_app@localhost:5432/lifestyle_test_unit',
  DATABASE_MIGRATION_URL: 'postgresql://lifestyle_migrator@localhost:5432/lifestyle_test_unit',
  REDIS_URL: 'redis://localhost:6379/15',
  ALLOW_DESTRUCTIVE_TESTS: 'isolated-resources-only'
};
function spyShell(script, args = [], changes = {}, failMigration = false) {
  const scratch = mkdtempSync(join(tmpdir(), 'lifestyle-helper-test-'));
  try {
    const log = join(scratch, 'calls.txt');
    writeFileSync(join(scratch, 'node'), `#!/bin/sh
case "$1" in
  scripts/check-forbidden.mjs) printf '%s\\n' 'node forbidden-guard (fixture)' >> "$COMMAND_LOG"; exit 0;;
  *) exec ${JSON.stringify(process.execPath)} "$@";;
esac
`, { mode: 0o700 });
    writeFileSync(join(scratch, 'npm'), `#!/bin/sh
printf '%s\\n' "$*" >> "$COMMAND_LOG"
if [ "$FAIL_MIGRATE" = yes ] && [ "$*" = 'run migrate:up' ]; then exit 17; fi
`, { mode: 0o700 });
    // A regression must not reach actual system setup/service commands in tests.
    for (const command of ['sudo', 'psql', 'redis-server', 'redis-cli', 'docker']) {
      writeFileSync(join(scratch, command), '#!/bin/sh\nprintf "UNEXPECTED service command\\n" >> "$COMMAND_LOG"\nexit 99\n', { mode: 0o700 });
    }
    const result = spawnSync('bash', [join(root, script), ...args], {
      cwd: scratch, encoding: 'utf8', env: {
        ...process.env, ...targets, ...changes, PATH: `${scratch}:${process.env.PATH}`,
        COMMAND_LOG: log, FAIL_MIGRATE: failMigration ? 'yes' : 'no'
      }
    });
    let calls = [];
    try { calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
    return { ...result, calls };
  } finally {
    // Only this test's newly allocated scratch directory, never user/application data.
    rmSync(scratch, { recursive: true, force: true });
  }
}

test('configuration preflight is non-mutating and independent of caller cwd', () => {
  const result = spyShell('scripts/ensure-env.sh');
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls, []);
  assert.match(result.stdout, /connectivity\/isolation proof NOT RUN/);
  assert.match(result.stdout, /No dependencies, services, databases or migrations were changed/);
});

test('missing preflight environment fails without setup/false readiness', () => {
  const result = spyShell('scripts/ensure-env.sh', [], { DATABASE_MIGRATION_URL: '' });
  assert.equal(result.status, 2);
  assert.deepEqual(result.calls, []);
  assert.doesNotMatch(result.stdout, /PASS|Environment ready/);
});

test('configuration parser diagnostics never echo malformed URL secrets', () => {
  const marker = 'unit-private-marker';
  const result = spyShell('scripts/ensure-env.sh', [], { DATABASE_URL: `malformed-${marker}` });
  assert.equal(result.status, 2);
  assert.ok(!(result.stdout + result.stderr).includes(marker));
});

test('unit-mode shell orchestration never runs migrations or infrastructure suites (command spies)', () => {
  const result = spyShell('scripts/verify-ci.sh');
  assert.equal(result.status, 0);
  assert.ok(result.calls.includes('run test:unit'));
  assert.ok(result.calls.includes('run typecheck:tests'));
  assert.ok(result.calls.every((call) => !/migrate|coverage|UNEXPECTED/.test(call)));
});

for (const [label, change] of [
  ['missing acknowledgement', { ALLOW_DESTRUCTIVE_TESTS: '' }],
  ['development database', { DATABASE_URL: 'postgresql://lifestyle_app@localhost/lifestyle_dev' }],
  ['Redis zero', { REDIS_URL: 'redis://localhost:6379/0' }],
  ['different migration host', { DATABASE_MIGRATION_URL: 'postgresql://lifestyle_migrator@other/lifestyle_test_unit' }],
  ['different migration database', { DATABASE_MIGRATION_URL: 'postgresql://lifestyle_migrator@localhost:5432/lifestyle_test_other' }],
  ['runtime superuser', { DATABASE_URL: 'postgresql://postgres@localhost:5432/lifestyle_test_unit' }],
  ['migration identity override', { DATABASE_MIGRATION_URL: 'postgresql://lifestyle_migrator@localhost:5432/lifestyle_test_unit?host=other' }],
  ['Redis URL override', { REDIS_URL: 'redis://localhost:6379/15?db=0' }]
]) {
  test(`isolated helper rejects ${label} before any migration/test command`, () => {
    const result = spyShell('scripts/verify-ci.sh', ['--isolated'], change);
    assert.equal(result.status, 2);
    assert.deepEqual(result.calls, []);
  });
}

test('isolated mode command spies prove forward up/repeat only; no real DB execution', () => {
  const result = spyShell('scripts/verify-ci.sh', ['--isolated']);
  assert.equal(result.status, 0);
  assert.equal(result.calls.filter((s) => s === 'run migrate:up').length, 2);
  assert.ok(result.calls.includes('run test:coverage'));
  assert.ok(result.calls.every((s) => !s.includes('migrate:down')));
});

test('migration error propagates without repeat, tests or false success (command spies)', () => {
  const result = spyShell('scripts/verify-ci.sh', ['--isolated'], {}, true);
  assert.equal(result.status, 17);
  assert.equal(result.calls.filter((s) => s === 'run migrate:up').length, 1);
  assert.ok(!result.calls.includes('run test:coverage'));
  assert.doesNotMatch(result.stdout, /requested --isolated verification commands completed/);
});

test('explicit guard accepts equivalent default PostgreSQL ports, rejects invalid modes', () => {
  assert.doesNotThrow(() => checkEnvironment({ ...targets,
    DATABASE_MIGRATION_URL: 'postgres://lifestyle_migrator@localhost/lifestyle_test_unit'
  }, 'isolated'));
  assert.throws(() => checkEnvironment(targets, 'unsafe'));
});

test('canonical compose entry point limits database/Redis/mail host exposure', () => {
  const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
  for (const port of ['5432', '6379', '1025', '8025']) {
    assert.ok(compose.includes(`"127.0.0.1:${port}:${port}"`));
  }
  // Finding B-32 removed the duplicate compose/Dockerfile pair; do not reintroduce it.
  assert.equal(existsSync(join(root, 'docker/docker-compose.yml')), false);
  assert.equal(existsSync(join(root, 'docker/Dockerfile')), false);
  assert.equal(existsSync(join(root, 'backend/Dockerfile')), true);
});

test('all 18 historical findings retain provenance, past outcomes and current source fingerprints', () => {
  const triageText = readFileSync(join(root, 'docs/remediation/secret-triage.json'), 'utf8');
  const triage = JSON.parse(triageText);
  assert.equal(triage.records.length, 18);
  assert.equal(new Set(triage.records.map((r) => `${r.original_file}:${r.original_line}`)).size, 18);
  for (const row of triage.records) {
    assert.equal(row.production_reuse_verification, 'BLOCKED');
    let expected = row.source_sha256_after_fresh_setup;
    for (const followup of row.source_followups ?? []) {
      assert.equal(followup.previous_source_sha256, expected, 'Preserve the earlier provenance fingerprint chain');
      assert.ok(followup.reason.length > 20);
      assert.match(followup.source_sha256, /^[a-f0-9]{64}$/);
      expected = followup.source_sha256;
    }
    if (row.deleted_after_review === true) {
      assert.equal(existsSync(join(root, row.original_file)), false, 'Deleted historical source must stay absent');
      assert.ok(String(row.deletion_reason ?? '').length > 20, 'Document why the historical source was removed');
    } else {
      const text = readFileSync(join(root, row.original_file), 'utf8');
      const after = createHash('sha256').update(text).digest('hex');
      assert.equal(after, expected, 'Current source fingerprint must match the documented follow-up');
    }
    assert.match(row.source_sha256_before_review, /^[a-f0-9]{64}$/);
    assert.match(row.source_sha256_after_review, /^[a-f0-9]{64}$/);
    assert.equal(row.current_detector_match, false);
    assert.ok(!triageText.includes(row.username.replace('lifestyle_', '') + '_local_pass'), 'No historical password values in provenance');
  }
  assert.equal(triage.previous_review_summary.remaining_detector_matches, 16);
  assert.equal(triage.review_summary.remaining_detector_matches, 0);
  assert.equal(triage.records.filter((r) => r.previous_review.current_detector_match).length, 16);
});
