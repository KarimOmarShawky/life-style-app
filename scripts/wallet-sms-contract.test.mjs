// Contracts that remain relevant after retiring the native SMS wallet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const mobile = 'mobile-app/mobile/';

test('F-04 every shipped reminder path requests a deliverable channel', () => {
  const form = read(mobile + 'lib/features/calendar/presentation/event_form_screen.dart');
  const repository = read(mobile + 'lib/features/calendar/data/calendar_repository.dart');
  const channel = read(mobile + 'lib/features/calendar/data/reminder_channel.dart');
  assert.ok(channel.includes("static const String inApp = 'in_app';"));
  assert.ok(form.includes('CalendarReminderChannel.inApp'));
  assert.ok(!/'channel':\s*'push'/.test(form));
  assert.ok(repository.includes('CalendarReminderChannel.inApp'));
  assert.ok(!/'channel':\s*'push'/.test(repository));
  // The worker still has no push provider, so push rows are failed at once.
  const processors = read('backend/src/jobs/job-processors.ts');
  assert.ok(processors.includes('permanentlyUnavailable'));
  assert.ok(read('backend/src/worker.ts').includes('permanentlyUnavailable: true'));
});

test('F-07 the client renders the full search scope, not five of seven groups', () => {
  const models = read(mobile + 'lib/features/more/data/daily_plan_models.dart');
  const delegate = read(mobile + 'lib/features/home/presentation/widgets/global_search_delegate.dart');
  // Models for the two groups the audit found missing.
  assert.ok(models.includes('class SearchGoalItem'));
  assert.ok(models.includes('class SearchSubscriptionItem'));
  assert.ok(models.includes("jsonSearchList(json['goals'])"));
  assert.ok(models.includes("jsonSearchList(json['subscriptions'])"));
  // A deployment that does not return them yet degrades instead of throwing.
  assert.ok(models.includes('List<Map<String, dynamic>> jsonSearchList(Object? value)'));
  // The delegate renders goals and merges subscription hits by id.
  assert.ok(delegate.includes('serverGoals'));
  assert.ok(delegate.includes('l10n.goalsTitle'));
  assert.ok(delegate.includes('subscriptionById'));
  assert.ok(delegate.includes('serverSubscriptions'));
  // Backend returns both groups.
  const types = read('backend/src/features/search/search.types.ts');
  assert.ok(types.includes('goals: GoalSearchItem[];'));
  assert.ok(types.includes('subscriptions: SubscriptionSearchItem[];'));
});

// A cheap source check only; Flutter analysis remains authoritative.
function dartFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return dartFiles(path);
    return entry.isFile() && entry.name.endsWith('.dart') ? [path] : [];
  });
}

test('Dart source and tests do not repeat an identical simple import', () => {
  const base = fileURLToPath(new URL('../mobile-app/mobile/', import.meta.url));
  for (const file of ['lib', 'test'].flatMap((dir) => dartFiles(join(base, dir)))) {
    const imports = readFileSync(file, 'utf8').match(/^import\s+['"][^'"]+['"]\s*;/gm) ?? [];
    assert.equal(new Set(imports).size, imports.length, `duplicate import in ${file}`);
  }
});
