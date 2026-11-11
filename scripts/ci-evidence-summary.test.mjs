import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  evidenceHeader,
  evidenceRow,
  parseFlutter,
  parseJunitXml,
  parseNodeTest,
  parseVitest,
  run
} from './ci-evidence-summary.mjs';

const vitestLog = [
  ' \x1b[32m✓\x1b[39m tests/unit/a.test.ts (3 tests) 12ms',
  '',
  '\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m82 passed\x1b[39m\x1b[22m\x1b[90m | \x1b[39m\x1b[33m5 skipped\x1b[39m\x1b[90m (87)\x1b[39m',
  '\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m664 passed\x1b[39m\x1b[22m\x1b[90m | \x1b[39m\x1b[33m5 skipped\x1b[39m\x1b[90m (669)\x1b[39m',
  '\x1b[2m   Start at \x1b[22m 18:44:01'
].join('\n');

test('parses Vitest file and test totals through ANSI colour codes', () => {
  const parsed = parseVitest(vitestLog);
  assert.deepEqual(parsed.files, { passed: 82, failed: 0, skipped: 5, todo: 0, total: 87 });
  assert.deepEqual(parsed.tests, { passed: 664, failed: 0, skipped: 5, todo: 0, total: 669 });
});

test('a failing Vitest run is reported as FAIL with its failure count', () => {
  const parsed = parseVitest(' Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 40 passed (42)\n');
  assert.equal(parsed.tests.failed, 2);
  assert.match(evidenceRow('Backend', parsed, { EVIDENCE_HEAD_SHA: 'abc' }), /\| FAIL \|/);
});

test('parses the node --test TAP footer', () => {
  const parsed = parseNodeTest(
    '# Subtest: x\nok 1 - x\n1..171\n# tests 171\n# suites 20\n# pass 170\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n# duration_ms 900\n'
  );
  assert.deepEqual(parsed.tests, { total: 171, passed: 170, failed: 0, skipped: 1, todo: 0 });
});

test('parses the final flutter test progress line, including skips and failures', () => {
  const ok = parseFlutter('00:01 +1: loading\n00:45 +312 ~2: All tests passed!\n');
  assert.deepEqual(ok.tests, { passed: 312, skipped: 2, failed: 0, todo: 0, total: 314 });
  const bad = parseFlutter('00:30 +10: a\n01:02 +300 -2: Some tests failed.\n');
  assert.deepEqual(bad.tests, { passed: 300, skipped: 0, failed: 2, todo: 0, total: 302 });
});

test('sums JUnit XML suites (Gradle test results)', () => {
  const parsed = parseJunitXml([
    '<?xml version="1.0"?><testsuite name="A" tests="5" skipped="1" failures="0" errors="0" time="0.1">',
    '<testsuite name="B" tests="3" skipped="0" failures="1" errors="0">'
  ]);
  assert.equal(parsed.suites, 2);
  assert.deepEqual(parsed.tests, { passed: 6, failed: 1, skipped: 1, todo: 0, total: 8 });
});

test('never invents numbers: unrecognised logs produce an explicit unavailable row', () => {
  assert.equal(parseVitest('nothing useful'), null);
  assert.equal(parseFlutter(''), null);
  assert.equal(parseNodeTest('ok 1'), null);
  assert.equal(parseJunitXml([]), null);
  const row = evidenceRow('Flutter tests', null, { EVIDENCE_HEAD_SHA: '0123456789abcdef' });
  assert.match(row, /counts unavailable/);
  assert.doesNotMatch(row, /\d+ passed/);
  assert.match(row, /`0123456789ab`/);
});

test('header records head commit, tested tree, run identity and supplied toolchain versions', () => {
  const header = evidenceHeader('Backend gate', ['Flutter=Flutter 3.38.0 • channel stable', 'bad-entry'], {
    EVIDENCE_HEAD_SHA: 'head123',
    GITHUB_SHA: 'merge456',
    GITHUB_REF: 'refs/pull/30/merge',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_RUN_ID: '99',
    GITHUB_RUN_ATTEMPT: '2',
    RUNNER_OS: 'Linux'
  });
  assert.match(header, /Head commit: `head123`/);
  assert.match(header, /Tested tree .*`merge456`/);
  assert.match(header, /Run: `99` attempt `2`/);
  assert.match(header, /- Flutter: `Flutter 3\.38\.0 • channel stable`/);
  assert.doesNotMatch(header, /bad-entry/);
  assert.match(header, /\| Gate \| Result \|/);
});

test('table cells cannot be broken by pipes or newlines in labels', () => {
  const row = evidenceRow('a | b\nc', { tests: { passed: 1, failed: 0, skipped: 0, todo: 0, total: 1 } }, {});
  assert.equal(row.split('\n').length, 2);
  assert.match(row, /a \\\| b c/);
});

test('CLI appends to GITHUB_STEP_SUMMARY and reads JUnit directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  try {
    const summary = join(dir, 'summary.md');
    const log = join(dir, 'vitest.log');
    writeFileSync(log, vitestLog);
    const results = join(dir, 'results');
    execFileSync('mkdir', ['-p', results]);
    writeFileSync(join(results, 'TEST-a.xml'), '<testsuite name="a" tests="4" skipped="0" failures="0" errors="0">');
    const script = new URL('./ci-evidence-summary.mjs', import.meta.url).pathname;
    const env = { ...process.env, GITHUB_STEP_SUMMARY: summary, EVIDENCE_HEAD_SHA: 'feedbeef' };
    execFileSync(process.execPath, [script, 'vitest', 'Backend npm test', log], { env });
    execFileSync(process.execPath, [script, 'junit', 'Kotlin', results], { env });
    const text = readFileSync(summary, 'utf8');
    assert.match(text, /Backend npm test \| PASS \| files: 82 passed, 5 skipped, 87 total; tests: 664 passed/);
    assert.match(text, /Kotlin \| PASS \| suites: 1; tests: 4 passed, 4 total/);
    assert.throws(() => run(['bogus']), /usage/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
