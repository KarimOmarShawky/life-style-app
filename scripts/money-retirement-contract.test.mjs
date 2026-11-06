import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const mobile = 'mobile-app/mobile/';

test('retired wallet SMS is not registered or requested by the Android manifest', () => {
  const manifest = read(mobile + 'android/app/src/main/AndroidManifest.xml');
  assert.ok(!manifest.includes('android.permission.RECEIVE_SMS'));
  assert.ok(!manifest.includes('SmsTransactionReceiver'));
  assert.ok(!manifest.includes('android.provider.telephony.SMS_RECEIVED'));
  assert.ok(manifest.includes('SubscriptionReminderReceiver'));
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

test('production app mounts retirement guards before the legacy routers', () => {
  const app = read('backend/src/app.ts');
  assert.match(app, /'\/money',\s*retiredMoneyGuard,\s*createMoneyRouter/);
  assert.match(app, /'\/ingest',\s*retiredIngestGuard,\s*createIngestRouter/);
});
