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

test('both runtimes persist and recheck content-free legacy age-hold markers', () => {
  assert.ok(native.includes('const val LEGACY_HOLD_PREFIX = "flutter.wallet_legacy_hold."'));
  assert.ok(reviews.includes("static const String legacyHoldPrefix = 'wallet_legacy_hold.';"));
  const nativeCandidate = native.split('private fun flushCandidates(')[1].split('private enum class CandidateOutcome')[0];
  const dartCandidate = reviews.split('Future<int> flush() async {')[1].split('Future<CandidateDecision> _applyResult')[0];
  assert.ok(nativeCandidate.includes('commitEntry(prefs, holdKey, "HELD")'));
  assert.ok(nativeCandidate.indexOf('prefs.contains(holdKey)') < nativeCandidate.indexOf('postAnalyze('));
  assert.ok(nativeCandidate.lastIndexOf('prefs.contains(holdKey)') > nativeCandidate.indexOf('postAnalyze('));
  assert.ok(dartCandidate.includes('await _markLegacyHold(prefs, holdKey)'));
  assert.ok(dartCandidate.indexOf('prefs.containsKey(holdKey)') < dartCandidate.indexOf('_api.post('));
  assert.ok(dartCandidate.lastIndexOf('prefs.containsKey(holdKey)') > dartCandidate.indexOf('_api.post('));
  const nativeQuarantine = native.split('private fun retryQuarantined(')[1].split('private fun handleAnalysisResult(')[0];
  const dartQuarantine = reviews.split('Future<void> _retryQuarantined(')[1].split('Future<bool> _removeEntry(')[0];
  assert.ok(nativeQuarantine.includes('commitEntry(prefs, holdKey, "HELD")'));
  assert.ok(dartQuarantine.includes('await _markLegacyHold(prefs, holdKey)'));
  assert.ok(nativeQuarantine.indexOf('prefs.contains(holdKey)') < nativeQuarantine.indexOf('commitEntry(prefs, target'));
  assert.ok(dartQuarantine.indexOf('prefs.containsKey(holdKey)') < dartQuarantine.indexOf('prefs.setString(target'));
});

test('held review items cannot be listed or deliberately removed by review actions', () => {
  const review = reviews.split('class PendingWalletReviews {')[1].split('class WalletSmsCandidate')[0];
  assert.ok(review.indexOf('prefs.containsKey(') < review.indexOf('items.add(item)'));
  assert.ok(review.includes('item.id != id'));
  assert.ok(review.indexOf('throw const WalletLegacyHeldException();') < review.indexOf('_repository.createTransaction('));
  const remove = review.split('Future<bool> _remove(')[1];
  assert.ok(remove.indexOf('throw const WalletLegacyHeldException();') < remove.indexOf('prefs.remove(key)'));
});
