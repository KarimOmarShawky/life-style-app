/**
 * scripts/docs-consistency.test.mjs
 *
 * Tests for the F-08 documentation consistency guard. The guard is only useful
 * if it fails on the exact drift the audit found, so each rule is exercised
 * with a deliberately stale fixture in a throwaway tree, plus one assertion
 * that the real repository passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkDocsConsistency } from './check-docs-consistency.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const CANONICAL_DEFERRED = `# Deferred Features & Non-Goals

| Category | Excluded Feature / Technology | Justification & Architectural Policy |
| :--- | :--- | :--- |
| **Search scope** | Financial transactions in global search | \`GET /search\` covers tasks, notes, habits, projects, events, goals and subscriptions. Transactions stay out of global search by product decision; the Money API does expose \`GET /money/transactions\` and \`GET /money/transactions/{id}\`, and search must not become a second transaction-history surface. |
| Backend query surfaces (\`/search\`, canonical \`/dashboard\`, \`/day/today\`, \`/day/{date}\`) | Mobile-first parity assumption | Active and tested in backend API. The older \`/dashboard/overview\` and \`/days/:date\` aliases were removed in favour of the canonical routes - do not reintroduce them |
`;

const BASE_FILES = {
  'package.json': '{"name":"fixture"}',
  'README.md': '# LifeStyle\n\n```\n├── mobile-app/mobile/\n```\n',
  'mobile-app/mobile/pubspec.yaml': 'name: lifestyle_mobile\n',
  'docs/architecture/deferred-and-non-goals.md': CANONICAL_DEFERRED,
  'docs/api/openapi.yaml':
    'paths:\n  /money/transactions:\n    get:\n      operationId: listTransactions\n  /money/transactions/{id}:\n    get:\n      operationId: getTransaction\n',
  'backend/src/features/search/search.types.ts':
    'export interface SearchResults {\n  goals: GoalSearchItem[];\n  subscriptions: SubscriptionSearchItem[];\n}\n',
  'docs/mobile/flutter-integration.md':
    '- Queues are sealed with the non-exportable Keystore key before they are written.\n',
  'docs/reports/spec-verification-2026-10-24.md':
    '# Report\n\n> **Historical snapshot (2026-10-24).** Describes the tree on that date.\n'
};

/** Writes a throwaway repository tree and returns its path. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docs-consistency-'));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return dir;
}

function rulesFor(files) {
  const dir = fixture({ ...BASE_FILES, ...files });
  try {
    return checkDocsConsistency(dir).map((finding) => finding.rule);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the repository itself passes every documentation rule', () => {
  assert.deepEqual(checkDocsConsistency(REPO_ROOT), []);
});

test('a top-level mobile/ package path is rejected', () => {
  for (const stale of [
    '# LifeStyle\n\n```\n├── mobile/\n```\n',
    '# LifeStyle\n\n- English localization in `mobile/lib/l10n/`.\n',
    '# LifeStyle\n\n```bash\ncd mobile\nflutter pub get\n```\n',
    '# LifeStyle\n\n```bash\ncd ../mobile\nflutter pub get\n```\n'
  ]) {
    assert.ok(rulesFor({ 'README.md': stale }).includes('package-path'), stale);
  }
});

test('the canonical mobile-app/mobile/ path and docs/mobile/ links are accepted', () => {
  const rules = rulesFor({ 'README.md': '# LifeStyle\n\nSee [Flutter integration](docs/mobile/flutter-integration.md) and `mobile-app/mobile/pubspec.yaml`.\n' });
  assert.deepEqual(rules, []);
});

test('a removed route alias mentioned as if it were active is rejected', () => {
  const stale = CANONICAL_DEFERRED.replace(
    '| Backend query surfaces (`/search`, canonical `/dashboard`, `/day/today`, `/day/{date}`) | Mobile-first parity assumption | Active and tested in backend API.',
    '| Backend query surfaces (`/dashboard/overview`, `/days/:date`) | Mobile-first parity assumption | Active and tested in backend API.'
  );
  assert.ok(rulesFor({ 'docs/architecture/deferred-and-non-goals.md': stale }).includes('canonical-routes'));
});

test('missing canonical routes are rejected', () => {
  const empty = rulesFor({
    'docs/architecture/deferred-and-non-goals.md': '# Deferred\n\n| Category | Excluded | Why |\n| :--- | :--- | :--- |\n'
  }).filter((rule) => rule === 'canonical-routes');
  // One finding per canonical route (/search, /dashboard, /day/today, /day/{date})
  // plus one for the missing search-scope row.
  assert.equal(empty.length, 4);
});

test('a dated report without the historical banner is rejected', () => {
  const rules = rulesFor({ 'docs/reports/phase-x-2026-11-02.md': '# Phase X\n\nJust a report.\n' });
  assert.ok(rules.includes('historical-labelling'));
});

test('an undated report needs no banner', () => {
  assert.deepEqual(rulesFor({ 'docs/reports/phase-p2-delivery-report.md': '# Phase P2\n\nNo date in the filename.\n' }), []);
});

test('the search scope must be documented and must exclude transactions explicitly', () => {
  const withoutRow = CANONICAL_DEFERRED.replace(/\| \*\*Search scope\*\*.*\n/, '');
  assert.ok(rulesFor({ 'docs/architecture/deferred-and-non-goals.md': withoutRow }).includes('search-scope'));

  const withoutDomains = CANONICAL_DEFERRED.replace('goals and subscriptions', 'goals');
  assert.ok(rulesFor({ 'docs/architecture/deferred-and-non-goals.md': withoutDomains }).includes('search-scope'));
});

test('search code that drops goals/subscriptions or adds transactions fails the scope rule', () => {
  assert.ok(
    rulesFor({ 'backend/src/features/search/search.types.ts': 'export interface SearchResults {\n  tasks: TaskItem[];\n}\n' })
      .includes('search-scope')
  );
  assert.ok(
    rulesFor({
      'docs/api/openapi.yaml':
    'paths:\n  /money/transactions:\n    get:\n      operationId: listTransactions\n  /money/transactions/{id}:\n    get:\n      operationId: getTransaction\n',
  'backend/src/features/search/search.types.ts':
        'export interface SearchResults {\n  goals: GoalSearchItem[];\n  subscriptions: SubscriptionSearchItem[];\n  transactions: TransactionItem[];\n}\n'
    }).includes('search-scope')
  );
});

test('claiming the product has no transaction history fails against the OpenAPI contract (V-11)', () => {
  const falseClaim = CANONICAL_DEFERRED.replace(
    'Transactions stay out of global search by product decision; the Money API does expose `GET /money/transactions` and `GET /money/transactions/{id}`, and search must not become a second transaction-history surface.',
    'Transactions stay out: Money deliberately exposes no transaction-history surface anywhere in the product, and search must not create one.'
  );
  const findings = rulesFor({ 'docs/architecture/deferred-and-non-goals.md': falseClaim });
  assert.ok(findings.includes('transaction-history'), 'the false claim must fail the guard');

  // The same sentence inside a dated, explicitly corrected historical note is not a live claim.
  const corrected = `# Deferred\n\n> **Correction:** the earlier wording said Money exposes no transaction-history surface anywhere in the product; that was false.\n`;
  assert.ok(
    !rulesFor({ 'docs/architecture/deferred-and-non-goals.md': CANONICAL_DEFERRED + corrected }).includes(
      'transaction-history'
    )
  );
});

test('the scope row must record the real boundary and the contract must exist', () => {
  const vague = CANONICAL_DEFERRED.replaceAll('/money/transactions/{id}', '/money/x').replaceAll(
    '`GET /money/transactions`',
    '`GET /money/x`'
  );
  assert.ok(
    rulesFor({ 'docs/architecture/deferred-and-non-goals.md': vague }).includes('transaction-history')
  );

  const dir = fixture({ ...BASE_FILES });
  rmSync(join(dir, 'docs/api/openapi.yaml'));
  try {
    const findings = checkDocsConsistency(dir).map((f) => f.rule);
    assert.ok(findings.includes('transaction-history'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('describing the wallet queues as plaintext is rejected', () => {
  assert.ok(
    rulesFor({ 'docs/mobile/flutter-integration.md': '- SMS candidate queues remain plaintext in private app preferences.\n' })
      .includes('queue-storage')
  );
  assert.ok(
    rulesFor({ 'docs/mobile/flutter-integration.md': '- Do not describe all local SMS storage as encrypted.\n' })
      .includes('queue-storage')
  );
});

test('the guard refuses a directory that is not the repository root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-consistency-empty-'));
  try {
    assert.throws(() => checkDocsConsistency(dir), /Not the repository root/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
