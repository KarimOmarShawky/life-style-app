#!/usr/bin/env node
/**
 * E1 evidence rows for the GitHub job summary.
 *
 * Every count is parsed from the gate's own log or JUnit XML written on the
 * runner. When a count cannot be parsed the row says so instead of guessing:
 * evidence must never contain an invented number.
 *
 * Usage (from any directory):
 *   node scripts/ci-evidence-summary.mjs header "Job name" ["Tool=version" ...]
 *   node scripts/ci-evidence-summary.mjs vitest "Gate label" path/to/vitest.log
 *   node scripts/ci-evidence-summary.mjs node-test "Gate label" path/to/tap.log
 *   node scripts/ci-evidence-summary.mjs flutter "Gate label" path/to/flutter-test.log
 *   node scripts/ci-evidence-summary.mjs junit "Gate label" path/to/test-results-dir
 *
 * Output goes to $GITHUB_STEP_SUMMARY when set, otherwise to stdout. The
 * script exits 0 even when a log is unreadable, because the summary is
 * diagnostic: the gate's own exit status decides PASS or FAIL.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text) {
  return String(text).replace(ANSI, '');
}

function countsFrom(segment) {
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, total: null };
  for (const match of segment.matchAll(/(\d+)\s+(passed|failed|skipped|todo)/g)) {
    counts[match[2]] = Number(match[1]);
  }
  const total = /\((\d+)\)/.exec(segment);
  if (total) counts.total = Number(total[1]);
  return counts;
}

/** Parses Vitest's final "Test Files" and "Tests" lines. */
export function parseVitest(log) {
  const text = stripAnsi(log);
  const files = [...text.matchAll(/^\s*Test Files\s+(.+)$/gm)].at(-1);
  const tests = [...text.matchAll(/^\s*Tests\s+(.+)$/gm)].at(-1);
  if (!tests) return null;
  return {
    files: files ? countsFrom(files[1]) : null,
    tests: countsFrom(tests[1])
  };
}

/** Parses the TAP footer printed by `node --test`. */
export function parseNodeTest(log) {
  const text = stripAnsi(log);
  const read = (name) => {
    const match = [...text.matchAll(new RegExp(`^#\\s*${name}\\s+(\\d+)\\s*$`, 'gm'))].at(-1);
    return match ? Number(match[1]) : null;
  };
  const total = read('tests');
  if (total === null) return null;
  return {
    tests: {
      total,
      passed: read('pass') ?? 0,
      failed: read('fail') ?? 0,
      skipped: (read('skipped') ?? 0) + (read('cancelled') ?? 0),
      todo: read('todo') ?? 0
    }
  };
}

/** Parses the last `+N ~S -F: ...` progress line printed by `flutter test`. */
export function parseFlutter(log) {
  const text = stripAnsi(log);
  const matches = [
    ...text.matchAll(/\+(\d+)(?: ~(\d+))?(?: -(\d+))?: (All tests passed!|Some tests failed\.)/g)
  ];
  const last = matches.at(-1);
  if (!last) return null;
  const passed = Number(last[1]);
  const skipped = last[2] ? Number(last[2]) : 0;
  const failed = last[3] ? Number(last[3]) : 0;
  return { tests: { passed, skipped, failed, todo: 0, total: passed + skipped + failed } };
}

/** Sums `<testsuite tests= failures= errors= skipped=>` across JUnit XML files. */
export function parseJunitXml(xmlDocuments) {
  const tests = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 };
  let suites = 0;
  for (const xml of xmlDocuments) {
    for (const match of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
      const attr = (name) => Number(new RegExp(`\\b${name}="(\\d+)"`).exec(match[1])?.[1] ?? 0);
      const total = attr('tests');
      const failed = attr('failures') + attr('errors');
      const skipped = attr('skipped');
      tests.total += total;
      tests.failed += failed;
      tests.skipped += skipped;
      tests.passed += total - failed - skipped;
      suites += 1;
    }
  }
  return suites === 0 ? null : { suites, tests };
}

function describe(counts) {
  if (!counts) return 'n/a';
  const parts = [`${counts.passed} passed`];
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  if (counts.todo) parts.push(`${counts.todo} todo`);
  if (counts.total !== null && counts.total !== undefined) parts.push(`${counts.total} total`);
  return parts.join(', ');
}

function cell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function headSha(env = process.env) {
  return env.EVIDENCE_HEAD_SHA || env.GITHUB_SHA || 'unknown';
}

/** Renders one evidence row; result is derived only from parsed counts. */
export function evidenceRow(label, parsed, env = process.env) {
  const sha = headSha(env).slice(0, 12);
  if (!parsed) {
    return `| ${cell(label)} | see job status | counts unavailable (log format not recognised) | \`${sha}\` |\n`;
  }
  const failed = parsed.tests.failed > 0;
  const fileText = parsed.files ? `files: ${describe(parsed.files)}; ` : '';
  const suiteText = parsed.suites ? `suites: ${parsed.suites}; ` : '';
  const result = failed ? 'FAIL' : 'PASS';
  return `| ${cell(label)} | ${result} | ${cell(fileText + suiteText + 'tests: ' + describe(parsed.tests))} | \`${sha}\` |\n`;
}

/** Renders the per-job header with commit identity and toolchain versions. */
export function evidenceHeader(job, tools = [], env = process.env) {
  const lines = [
    `### Evidence: ${cell(job)}`,
    '',
    `- Head commit: \`${headSha(env)}\``,
    `- Tested tree (GITHUB_SHA; a merge ref on pull requests): \`${env.GITHUB_SHA || 'unknown'}\``,
    `- Ref: \`${env.GITHUB_REF || 'unknown'}\` · event: \`${env.GITHUB_EVENT_NAME || 'unknown'}\``,
    `- Run: \`${env.GITHUB_RUN_ID || 'local'}\` attempt \`${env.GITHUB_RUN_ATTEMPT || '1'}\` · runner: \`${env.RUNNER_OS || process.platform}\``,
    `- Node.js: \`${process.version}\``
  ];
  for (const tool of tools) {
    const index = tool.indexOf('=');
    if (index <= 0) continue;
    lines.push(`- ${cell(tool.slice(0, index))}: \`${cell(tool.slice(index + 1).trim())}\``);
  }
  lines.push('', '| Gate | Result | Counts (parsed from runner output) | Commit |', '|---|---|---|---|', '');
  return lines.join('\n');
}

function readJunitDir(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.xml'))
    .map((name) => readFileSync(join(dir, name), 'utf8'));
}

function emit(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else process.stdout.write(text);
}

export function run(argv) {
  const [kind, label, source, ...rest] = argv;
  if (kind === 'header') {
    return evidenceHeader(label || 'job', [source, ...rest].filter(Boolean));
  }
  const parsers = { vitest: parseVitest, 'node-test': parseNodeTest, flutter: parseFlutter };
  if (kind === 'junit') return evidenceRow(label, parseJunitXml(readJunitDir(source)));
  if (!parsers[kind] || !label || !source) {
    throw new Error('usage: ci-evidence-summary.mjs <header|vitest|node-test|flutter|junit> <label> <log|dir>');
  }
  const log = existsSync(source) ? readFileSync(source, 'utf8') : '';
  return evidenceRow(label, parsers[kind](log));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    emit(run(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
