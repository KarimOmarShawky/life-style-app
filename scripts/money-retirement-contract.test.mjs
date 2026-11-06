import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const mobile = 'mobile-app/mobile/';

test('retired wallet SMS is not registered or requested by the Android manifest', () => {
  const manifest = read(mobile + 'android/app/src/main/AndroidManifest.xml');
  assert.ok(!manifest.includes('android.permission.RECEIVE_SMS'));
  assert.ok(!manifest.includes('SmsTransactionReceiver'));
  assert.ok(!manifest.includes('android.provider.telephony.SMS_RECEIVED'));
  assert.ok(manifest.includes('SubscriptionReminderReceiver'));
});

test('Focus Shield cannot ingest SMS notifications through its messaging inbox', () => {
  const native = mobile + 'android/app/src/main/kotlin/com/example/lifestyle_mobile/';
  const listener = read(native + 'FocusNotificationListenerService.kt');
  const sources = read(native + 'FocusMessageSources.kt');
  assert.ok(listener.includes('!FocusMessageSources.isSupported(sbn.packageName)'));
  assert.ok(!listener.includes('Telephony.Sms'));
  for (const sms of ['com.google.android.apps.messaging', 'com.android.mms', 'com.samsung.android.messaging']) {
    assert.ok(!sources.includes(sms));
  }
  assert.ok(sources.includes('com.whatsapp'));
});

test('home no longer displays money or flushes any wallet queues', () => {
  const home = read(mobile + 'lib/features/home/presentation/home_shell.dart');
  const routes = read(mobile + 'lib/navigation/deep_link_parser.dart');
  assert.ok(!home.includes('MoneyScreen'));
  assert.ok(!home.includes('_flushWalletQueue'));
  assert.ok(!home.includes('_ensureWalletIngestToken'));
  assert.ok(!routes.includes("'/money'"));
  assert.ok(home.includes('_syncRenewalReminders()'));
  const more = read(mobile + 'lib/features/more/presentation/more_screen.dart');
  assert.ok(more.includes('const SubscriptionsScreen()'));
});

test('production app mounts guards before subscription-only and revoke-only routers', () => {
  const app = read('backend/src/app.ts');
  assert.match(app, /'\/money',\s*retiredMoneyGuard,\s*createSubscriptionRouter/);
  assert.match(app, /'\/ingest',\s*retiredIngestGuard,\s*createRetiredIngestRouter/);
  const container = read('backend/src/container.ts');
  assert.ok(container.includes('new SubscriptionService('));
  assert.ok(!container.includes('new MoneyService('));
  assert.ok(!container.includes('GeminiSmsFallbackAnalyzer'));
  assert.ok(!container.includes('createIngestAuthenticateMiddleware'));
  const router = read('backend/src/features/money/subscription.routes.ts');
  assert.ok(!router.includes('/pay'));
  assert.ok(!router.includes('/transactions'));
  assert.ok(!router.includes('/budgets'));
  for (const path of [
    'backend/src/features/money/money.service.ts',
    'backend/src/features/money/money.controller.ts',
    'backend/src/features/money/money.repository.pg.ts',
    'backend/src/features/money/money.routes.ts',
    'backend/tests/support/legacy-money-test-app.ts'
  ]) {
    assert.equal(existsSync(path), false, `${path} must remain removed`);
  }
});

test('native wallet and SMS implementations and bridges cannot recreate retired data', () => {
  const native = mobile + 'android/app/src/main/kotlin/com/example/lifestyle_mobile/';
  for (const name of ['SmsTransactionReceiver', 'SmsSanitizer', 'WalletCredentialStore',
    'WalletBoundCredential', 'WalletCaptureGate', 'WalletQueueCipher',
    'WalletOwnedQueueCipher', 'WalletOwnedPayloadCipher', 'WalletLegacyRetention', 'WalletSenderScope']) {
    assert.ok(!existsSync(native + name + '.kt'), `${name} must stay retired`);
  }
  const activity = read(native + 'MainActivity.kt');
  for (const method of ['requestSmsPermission', 'checkSmsPermission', 'storeWalletIngestToken',
    'storeBoundWalletIngestToken', 'encryptWalletPayload', 'decryptWalletPayload']) {
    assert.ok(!activity.includes(`"${method}"`), `${method} must not be registered`);
  }
  assert.ok(activity.includes('RetiredWalletCleanup.run(this)'));
  assert.ok(activity.includes('"replaceSubscriptionReminders"'));
  assert.ok(activity.includes('"removeSubscriptionReminder"'));
  assert.ok(activity.includes('"clearSubscriptionReminders"'));
});

test('local retirement cleanup is narrow and retried at launch', () => {
  const startup = read(mobile + 'lib/main.dart');
  const cleanup = read(mobile + 'lib/data/retired_wallet_cleanup.dart');
  assert.ok(startup.includes('await RetiredWalletCleanup.run()'));
  assert.ok(cleanup.includes("'lifestyle.wallet_ingest_token.v1'"));
  assert.ok(cleanup.includes('FlutterSecureStorage().delete(key: _secureKey)'));
  assert.ok(!cleanup.includes('deleteAll('));
  assert.ok(!cleanup.includes('prefs.clear('));
  const native = read(mobile + 'android/app/src/main/kotlin/com/example/lifestyle_mobile/RetiredWalletCleanup.kt');
  assert.ok(native.includes('it.notification.channelId == retiredChannel'));
  assert.ok(!/notifications\.cancel\((998|999)\)/.test(native));
  assert.ok(native.includes('runSteps(steps)'));
});

test('production startup fails closed before API and worker can run on pre-erasure backups', () => {
  const server = read('backend/src/server.ts');
  const worker = read('backend/src/worker.ts');
  const guard = read('backend/src/infrastructure/database/postgres/financial-retirement-guard.ts');
  const draft = read('docs/remediation/drafts/1792800000000_erase_retired_money.cjs');
  for (const source of [server, worker]) {
    assert.ok(source.includes("env.NODE_ENV === 'production'"));
    assert.ok(source.includes('await assertFinancialRetirement('));
  }
  assert.ok(server.indexOf('await assertFinancialRetirement(') < server.indexOf('server.listen('));
  assert.ok(worker.indexOf('await assertFinancialRetirement(') < worker.indexOf('new Worker('));
  assert.ok(guard.includes("feature = 'legacy_money_v1'"));
  assert.ok(guard.includes('has_any_column_privilege'));
  assert.ok(draft.includes("VALUES ('legacy_money_v1')"));
});

test('subscription display loads full pages and keeps currency totals separate', () => {
  const repository = read(mobile + 'lib/features/money/data/money_repository.dart');
  const summary = read(mobile + 'lib/features/money/data/subscription_summary.dart');
  const screen = read(mobile + 'lib/features/money/presentation/subscriptions_screen.dart');
  assert.ok(repository.includes('listSubscriptions() => _listPages('));
  assert.ok(repository.includes("status: 'active', maxItems: 200"));
  assert.ok(repository.includes('seenIds.add(item.id)'));
  assert.ok(repository.includes('items.isEmpty'));
  assert.ok(summary.includes("item.status != 'active'"));
  assert.ok(summary.includes('unitsByCurrency'));
  assert.ok(summary.includes('BigInt.parse'));
  assert.ok(screen.includes('monthlySubscriptionTotals(subs)'));
  assert.ok(screen.includes('sortedSubscriptions'));
  assert.ok(!screen.includes('double monthlyTotal'));
});

test('analytics and preview do not promote retired financial features', () => {
  const analytics = read(mobile + 'lib/features/analytics/presentation/analytics_screen.dart');
  assert.ok(!analytics.includes("'moneySpent'"));
  assert.ok(!analytics.includes("'moneyBudget'"));
  assert.ok(!analytics.includes("'finance'"));
  const preview = read('backend/src/demo/live-preview-page.ts');
  assert.ok(!preview.includes('/money/budgets'));
  assert.ok(preview.includes('/money/subscriptions'));
});
