/**
 * scripts/wallet-sms-contract.test.mjs
 *
 * Source-level contract tests for the wallet SMS fallback and the local wallet
 * queues. The Android receiver is Kotlin and the queue is shared with Dart, so
 * neither side can be executed here (no JVM, no Flutter SDK). These assertions
 * pin the behaviour that the 2026-10-24 audit found broken (F-01, F-02, F-04,
 * F-05) against the actual source, and they run in CI and locally with
 * `node --test scripts/*.test.mjs`.
 *
 * They are contract assertions, not runtime proof: device, SQLite-free
 * SharedPreferences and Keystore behaviour still need the native/Flutter gates.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const mobile = 'mobile-app/mobile/';
const native = mobile + 'android/app/src/main/kotlin/com/example/lifestyle_mobile/';
const receiver = read(native + 'SmsTransactionReceiver.kt');
const cipher = read(native + 'WalletQueueCipher.kt');
const dartReviews = read(mobile + 'lib/features/money/data/pending_wallet_reviews.dart');
const dartTransactions = read(mobile + 'lib/features/money/data/pending_wallet_transactions.dart');
const dartCodec = read(mobile + 'lib/features/money/data/wallet_queue_codec.dart');
const envelope = read('backend/src/core/middleware/success-envelope.ts');
const analyzeController = read('backend/src/features/ingest/ingest.controller.ts');

test('F-01 native receiver decodes the v1 success envelope, not the JSON root', () => {
  assert.ok(receiver.includes('internal fun unwrapAnalyzeResult(body: String): JSONObject?'));
  assert.ok(
    receiver.includes('root.optBoolean("success", false) && !root.isNull("data")'),
    'the envelope must be unwrapped from data'
  );
  // handleAnalysisResult must consume the unwrapped result, never the raw body.
  const handler = receiver.split('private fun handleAnalysisResult(')[1].split('\n    }')[0];
  assert.ok(handler.includes('unwrapAnalyzeResult(body)'));
  assert.ok(!/JSONObject\(body\)/.test(handler));
  // The backend really wraps these responses.
  assert.ok(envelope.includes("originalJson({ success: true, data: body })"));
});

test('F-01 the candidate is deleted only after the result is handled', () => {
  const flush = receiver.split('private fun flushCandidates(')[1].split('\n    private enum class')[0];
  const handledBranch = flush.split('status in 200..299 && body != null -> {')[1].split('status == ANALYZE_UNAVAILABLE_STATUS')[0];
  const callIndex = handledBranch.indexOf('handleAnalysisResult(');
  const removeIndex = handledBranch.indexOf('removeEntry(prefs, key)');
  assert.ok(callIndex !== -1 && removeIndex !== -1);
  assert.ok(
    callIndex < removeIndex,
    'the candidate must be handled before it is removed'
  );
  // Removal happens inside the HANDLED branch only, and only after the
  // replacement record is confirmed durable (V-02).
  const handledOnly = handledBranch.split('CandidateOutcome.HANDLED -> {')[1].split('CandidateOutcome.RETRY_UNAVAILABLE')[0];
  assert.ok(handledOnly.includes('removeEntry(prefs, key)'));
  assert.ok(!handledBranch.slice(0, callIndex).includes('removeEntry('));
  // The removed key is verified: a failed removal is logged, never assumed.
  assert.ok(receiver.includes('private fun removeEntry(prefs: SharedPreferences, key: String): Boolean'));
});

test('F-02 unavailable is retryable and is never collapsed with unrecognized', () => {
  // Native: 503 is handled separately from the permanent rejection set.
  assert.ok(receiver.includes('private const val ANALYZE_UNAVAILABLE_STATUS = 503'));
  assert.ok(!/PERMANENT_REJECTIONS\s*=\s*setOf\([^)]*503/.test(receiver));
  assert.ok(receiver.includes('status == ANALYZE_UNAVAILABLE_STATUS -> {'));
  assert.ok(receiver.includes('STATUS_UNAVAILABLE -> return CandidateOutcome.RETRY_UNAVAILABLE'));
  assert.ok(receiver.includes('STATUS_UNRECOGNIZED -> return CandidateOutcome.HANDLED'));
  // V-01: every other status is retried, never treated as handled.
  assert.ok(receiver.includes('return CandidateOutcome.RETRY_UNKNOWN_STATUS'));
  assert.ok(!/status != "recognized"[^\n]*HANDLED/.test(receiver));
  // Backoff and the visible stalled state are bounded.
  assert.ok(receiver.includes('private const val CANDIDATE_BACKOFF_MS'));
  assert.ok(receiver.includes('private const val MAX_CANDIDATE_ATTEMPTS = 5'));
  assert.ok(receiver.includes('KEY_FALLBACK_UNAVAILABLE'));
  // Dart mirrors the same state machine.
  assert.ok(dartReviews.includes("case 'unavailable':"));
  assert.ok(dartReviews.includes('return const CandidateDecision.retry(CandidateRetryReason.unavailable);'));
  assert.ok(dartReviews.includes("case 'unrecognized':"));
  assert.ok(dartReviews.includes('return const CandidateDecision.retry(CandidateRetryReason.unknownStatus);'));
  assert.ok(dartReviews.includes('final reason = error.statusCode == 503'));
  // The backend never returns unavailable as a successful 2xx result.
  assert.ok(analyzeController.includes("if (result.status === 'unavailable') {"));
  assert.ok(analyzeController.includes("code: 'SMS_FALLBACK_UNAVAILABLE'"));
});

test('F-05 queue entries are sealed with a device key, never stored plaintext', () => {
  for (const marker of ['PENDING_PREFIX', 'CANDIDATE_PREFIX', 'REVIEW_PREFIX']) {
    // Every queue write goes through commitEntry, which verifies the write
    // reached disk instead of assuming it did (V-02).
    assert.ok(
      receiver.includes(`commitEntry(prefs, ${marker}`),
      `${marker} must still be written`
    );
  }
  assert.ok(receiver.includes('private fun commitEntry(prefs: SharedPreferences, key: String, stored: String): Boolean'));
  // Every queue write goes through the cipher; no raw JSON is put into prefs.
  assert.ok(receiver.includes('private fun writeCandidate('));
  assert.ok(receiver.includes('WalletQueueCipher().encrypt(item.toString())'));
  assert.ok(receiver.includes('WalletQueueCipher().encrypt(reviewItem.toString())'));
  assert.ok(!/putString\(\s*PENDING_PREFIX\s*\+\s*id,\s*item\.toString\(\)\s*\)/.test(receiver));
  assert.ok(!/putString\(\s*CANDIDATE_PREFIX\s*\+\s*id,\s*item\.toString\(\)\s*\)/.test(receiver));
  assert.ok(!/putString\(\s*REVIEW_PREFIX\s*\+\s*id,\s*reviewItem\.toString\(\)\s*\)/.test(receiver));
  // Keystore-backed, AES-GCM, no plaintext fallback.
  assert.ok(cipher.includes('"AndroidKeyStore"'));
  assert.ok(cipher.includes('AES/GCM/NoPadding'));
  assert.ok(cipher.includes('GCMParameterSpec(TAG_BITS'));
  // Retention: sanitized SMS text is not kept indefinitely.
  assert.ok(receiver.includes('private const val CANDIDATE_RETENTION_MS = 7L * 24'));
  assert.ok(receiver.includes('private fun dropExpiredCandidates('));
  assert.ok(dartReviews.includes('static const Duration retention = Duration(days: 7);'));
});

test('F-05 the Dart queue reads and writes through the shared codec', () => {
  assert.ok(dartCodec.includes('abstract class WalletQueueCodec'));
  assert.ok(dartCodec.includes('class PlatformWalletQueueCodec implements WalletQueueCodec'));
  assert.ok(dartCodec.includes("MethodChannel('com.example.lifestyle_mobile/native_voice')"));
  assert.ok(dartCodec.includes("'encryptWalletPayload'"));
  assert.ok(dartCodec.includes("'decryptWalletPayload'"));
  // The platform exposes exactly those methods.
  const activity = read(native + 'MainActivity.kt');
  assert.ok(activity.includes('"encryptWalletPayload", "decryptWalletPayload" ->'));
  // All three queues use the codec and fail closed without it.
  for (const source of [dartReviews, dartTransactions]) {
    assert.ok(source.includes('WalletQueueCodec? codec'), 'queues accept an injectable codec');
    assert.ok(source.includes('_codec.read(prefs, key)'), 'reads go through the codec');
  }
  assert.ok(dartReviews.includes('_codec.write('));
  assert.ok(dartCodec.includes('class WalletQueueSecurityException'));
  assert.ok(dartCodec.includes('class PlainWalletQueueCodec'));
  assert.match(dartCodec, /Only for tests: it provides no protection/);
  // The plain codec is test-only and is not referenced by app code.
  const appSources = ['lib/features/money/data/pending_wallet_reviews.dart',
    'lib/features/money/data/pending_wallet_transactions.dart',
    'lib/features/home/presentation/home_shell.dart',
    'lib/features/money/presentation/money_screen.dart'];
  for (const file of appSources) {
    assert.ok(!read(mobile + file).includes('PlainWalletQueueCodec'), `${file} must not use the test codec`);
  }
  // Backup stays disabled: encryption at rest is not provided by that flag.
  assert.ok(read(mobile + 'android/app/src/main/AndroidManifest.xml').includes('android:allowBackup="false"'));
});

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

test('F-02 the stalled fallback state is published and surfaced, never silently dropped', () => {
  const receiver = read(native + 'SmsTransactionReceiver.kt');
  // A retryable failure publishes a flag instead of deleting the candidate.
  assert.ok(receiver.includes('KEY_FALLBACK_UNAVAILABLE'));
  assert.ok(receiver.includes('private fun publishFallbackUnavailable'));
  // The flag is set on every retryable path and cleared after a success.
  assert.ok(receiver.includes('publishFallbackUnavailable(prefs)'));
  assert.ok(receiver.includes('if (prefs.contains(KEY_FALLBACK_UNAVAILABLE))'));
  // The Money screen reads the same key and renders it.
  const reviews = read(mobile + 'lib/features/money/data/pending_wallet_reviews.dart');
  assert.ok(reviews.includes("static const String key = 'wallet_sms_fallback_unavailable';"));
  assert.ok(reviews.includes('static Future<bool> isUnavailable()'));
  const screen = read(mobile + 'lib/features/money/presentation/money_screen.dart');
  assert.ok(screen.includes('WalletSmsFallbackStatus.isUnavailable()'));
  assert.ok(screen.includes('l10n.smsFallbackUnavailableTitle'));
  assert.ok(screen.includes('l10n.smsFallbackUnavailableDesc'));
  // Localized strings exist (other catalogs fall back to English by design).
  const loc = read(mobile + 'lib/l10n/app_localizations.dart');
  assert.ok(loc.includes("String get smsFallbackUnavailableTitle => _s('smsFallbackUnavailableTitle');"));
  assert.ok(loc.includes("String get smsFallbackUnavailableDesc => _s('smsFallbackUnavailableDesc');"));
  const catalog = read(mobile + 'lib/l10n/catalog_en.dart');
  assert.ok(catalog.includes("'smsFallbackUnavailableTitle':"));
  assert.ok(catalog.includes("'smsFallbackUnavailableDesc':"));
});

test('V-01/V-02 quarantined entries are kept, bounded and never revived forever', () => {
  const settings = read(mobile + 'lib/data/settings_provider.dart');
  // Native: a dedicated quarantine queue, written before the source is removed.
  assert.ok(receiver.includes('const val QUARANTINE_PREFIX = "flutter.pending_wallet_quarantine."'));
  assert.ok(receiver.includes('private const val MAX_QUARANTINE_ATTEMPTS = 2'));
  assert.ok(receiver.includes('private fun quarantine('));
  assert.ok(receiver.includes('publishQuarantineState(prefs, reason)'));
  // Only an unreadable payload may be restored: a malformed one would bounce.
  assert.ok(receiver.includes('if (entry.optString("reason") != QUARANTINE_UNREADABLE) continue'));
  // Quarantined entries expire with the same retention window (F-05).
  assert.ok(receiver.includes('JSONObject(raw).optLong("quarantinedAtMs", 0L)'));
  // Dart mirrors the envelope, the bound and the published state.
  assert.ok(dartReviews.includes("static const String quarantinePrefix = 'pending_wallet_quarantine.';"));
  assert.ok(dartReviews.includes("static const int _maxQuarantineAttempts = 2;"));
  assert.ok(dartReviews.includes("static const String unreadableReason = 'UNREADABLE';"));
  assert.ok(dartReviews.includes("if (decoded['reason'] != unreadableReason) continue;"));
  assert.ok(dartReviews.includes("static const String key = 'wallet_sms_quarantined';"));
  assert.ok(dartReviews.includes('static Future<bool> isQuarantined()'));
  // The state is surfaced on the Money screen, in every shipped catalog.
  const screen = read(mobile + 'lib/features/money/presentation/money_screen.dart');
  assert.ok(screen.includes('WalletSmsQuarantineStatus.isQuarantined()'));
  assert.ok(screen.includes('l10n.smsQuarantineTitle'));
  assert.ok(screen.includes('l10n.smsStorageFaultDesc'));
  const loc = read(mobile + 'lib/l10n/app_localizations.dart');
  assert.ok(loc.includes("String get smsQuarantineTitle => _s('smsQuarantineTitle');"));
  for (const locale of ['en', 'ar', 'fr', 'es', 'de', 'tr']) {
    assert.ok(
      read(mobile + `lib/l10n/catalog_${locale}.dart`).includes("'smsQuarantineTitle':"),
      `catalog_${locale} must carry the quarantine copy`
    );
  }
  // A failed queue write or removal is published, not swallowed.
  assert.ok(receiver.includes('const val KEY_STORAGE_FAULT = "flutter.wallet_storage_fault"'));
  assert.ok(receiver.includes('private fun publishStorageFault(prefs: SharedPreferences)'));
  assert.ok(dartReviews.includes("static const String storageFaultKey = 'wallet_storage_fault';"));
  assert.ok(dartReviews.includes('Future<void> _publishStorageFault(SharedPreferences prefs)'));
  // The sealed value can be re-checked without moving it back into a queue.
  assert.ok(dartCodec.includes('Future<String?> unseal(String stored);'));
  assert.ok(dartCodec.includes('Future<String?> unseal(String stored) async {'));
  assert.ok(dartCodec.includes('Future<bool> _publishStorageFault') === false);
  assert.ok(settings.includes("static const _walletNotificationDetailsKey = 'wallet_notification_details';"));
});

test('V-03 notifications never carry message content unless the user opts in', () => {
  const notification = receiver.split('private fun showTransactionNotification(')[1].split('private fun ')[0];
  // Private lock-screen visibility and a redacted public version.
  assert.ok(notification.includes('lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE'));
  assert.ok(notification.includes('.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)'));
  assert.ok(notification.includes('.setPublicVersion(publicVersion)'));
  // The raw SMS body is not part of the model any more, so it cannot be
  // rendered by accident.
  assert.ok(!receiver.includes('rawMessage'));
  assert.ok(!receiver.includes('BigTextStyle'));
  // Amount and merchant need an explicit opt-in flag.
  assert.ok(receiver.includes('private const val KEY_NOTIFICATION_DETAILS = "flutter.wallet_notification_details"'));
  assert.ok(notification.includes('KEY_NOTIFICATION_DETAILS'));
  const dartReviews = read(mobile + 'lib/features/money/data/pending_wallet_reviews.dart');
  assert.ok(dartReviews.includes('class WalletSmsNotificationDetails'));
  assert.ok(dartReviews.includes("static const String key = 'wallet_notification_details';"));
  const settings = read(mobile + 'lib/data/settings_provider.dart');
  assert.ok(settings.includes('setWalletNotificationDetails(bool enabled)'));
  // The switch only exists while capture is enabled, and defaults to off.
  const screen = read(mobile + 'lib/features/money/presentation/money_screen.dart');
  assert.ok(screen.includes('l10n.smsNotificationDetailsTitle'));
  assert.ok(screen.includes('setWalletNotificationDetails(value)'));
  const catalog = read(mobile + 'lib/l10n/catalog_en.dart');
  assert.ok(catalog.includes("'smsNotificationDetailsDesc':"));
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
