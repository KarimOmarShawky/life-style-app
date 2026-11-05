import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = 'mobile-app/mobile/lib/features/money/data/pending_wallet_transactions.dart';
const source = readFileSync(path, 'utf8');

test('unreadable or malformed queued wallet transactions are not silently deleted', () => {
  const invalid = source.split('if (item == null) {')[1]?.split('}')[0];
  assert.ok(invalid);
  assert.ok(!invalid.includes('prefs.remove'));
  assert.ok(invalid.includes('continue;'));
});

const native = readFileSync('mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/SmsTransactionReceiver.kt', 'utf8');
const reviews = readFileSync('mobile-app/mobile/lib/features/money/data/pending_wallet_reviews.dart', 'utf8');

test('rejected transaction uploads are durably blocked instead of deleted or auto-retried', () => {
  const dartFlush = source.split('Future<int> flush() async {')[1].split('  static String _withoutFlutterPrefix')[0];
  assert.ok(source.includes("static const String blockedPrefix = 'wallet_tx_rejected.';"));
  assert.ok(dartFlush.includes("final blockedKey = '$blockedPrefix${key.substring(keyPrefix.length)}';"));
  assert.ok(dartFlush.indexOf('prefs.containsKey(blockedKey)') < dartFlush.indexOf('_codec.read(prefs, key)'));
  assert.ok(dartFlush.includes('await _markRejected(prefs, blockedKey)'));
  const dartRejected = dartFlush.split('if (_isPermanentRejection(error)) {')[1].split('}')[0];
  assert.ok(!dartRejected.includes('prefs.remove'));
  assert.ok(dartFlush.lastIndexOf('prefs.containsKey(blockedKey)') > dartFlush.indexOf('_repository.createTransaction('));
  const nativeFlush = native.split('private fun flushQueue(')[1].split('private fun postTransaction(')[0];
  assert.ok(native.includes('const val REJECTED_TX_PREFIX = "flutter.wallet_tx_rejected."'));
  assert.ok(nativeFlush.includes('prefs.contains(blockedKey)'));
  assert.ok(nativeFlush.includes('commitEntry(prefs, blockedKey, "REJECTED")'));
  const nativeRejected = nativeFlush.split('else if (status in PERMANENT_REJECTIONS) {')[1].split('}')[0];
  assert.ok(!nativeRejected.includes('removeEntry'));
  assert.ok(nativeFlush.lastIndexOf('prefs.contains(blockedKey)') > nativeFlush.indexOf('postTransaction('));
  assert.ok(reviews.includes('PendingWalletTransactions.blockedPrefix'));
});
