import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';
import 'package:lifestyle_mobile/features/money/data/wallet_queue_codec.dart';

/// Wallet SMS fallback results waiting for user confirmation.
///
/// When the local Android parser cannot recognize a likely transaction, it
/// queues a sanitized candidate and the backend fallback (Gemini behind the
/// API) analyzes it. A high-confidence parse is auto-saved by the receiver; a
/// low-confidence parse is written here as `pending_wallet_review.<uuid>` and
/// is only saved after the user confirms it in the Money review flow. Money
/// has no full transaction-history list, so this queue is the only place to
/// review fallback results.
///
/// Candidate retries (`pending_wallet_candidate.<uuid>`) are handled by
/// [PendingWalletCandidates] when the app is open, so an offline or failed
/// background attempt is never lost.
///
/// Both queues are sealed with a device-bound key (F-05); see
/// [WalletQueueCodec].

/// One transaction produced by the SMS fallback, waiting for confirmation.
class WalletReviewItem {
  const WalletReviewItem({
    required this.id,
    required this.kind,
    required this.amount,
    required this.currency,
    required this.occurredOn,
    this.description,
    this.merchant,
    this.sender,
    this.text,
    this.createdAt,
  });

  final String id;
  final String kind;
  final String amount;
  final String currency;
  final String occurredOn;
  final String? description;
  final String? merchant;
  final String? sender;
  final String? text;
  final int? createdAt;

  /// Returns null when the stored value is missing or malformed. The schema is
  /// strict on purpose: anything else is dropped instead of shown.
  static WalletReviewItem? tryParse(String? raw) {
    if (raw == null) return null;
    final Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return null;
    }
    if (decoded is! Map<String, dynamic>) return null;

    final id = decoded['id'];
    final kind = decoded['kind'];
    final amount = decoded['amount'];
    final occurredOn = decoded['occurredOn'];
    if (id is! String ||
        id.isEmpty ||
        kind is! String ||
        (kind != 'expense' && kind != 'income') ||
        amount is! String ||
        !RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(amount) ||
        double.tryParse(amount) == null ||
        double.parse(amount) <= 0 ||
        occurredOn is! String ||
        !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(occurredOn)) {
      return null;
    }

    final currency = decoded['currency'];
    return WalletReviewItem(
      id: id,
      kind: kind,
      amount: amount,
      currency: currency is String && currency.isNotEmpty ? currency : 'EGP',
      occurredOn: occurredOn,
      description: decoded['description'] is String
          ? decoded['description'] as String
          : null,
      merchant:
          decoded['merchant'] is String ? decoded['merchant'] as String : null,
      sender: decoded['sender'] is String ? decoded['sender'] as String : null,
      text: decoded['text'] is String ? decoded['text'] as String : null,
      createdAt:
          decoded['createdAt'] is int ? decoded['createdAt'] as int : null,
    );
  }
}

/// Mirrors the `wallet_sms_fallback_unavailable` flag written by the native SMS
/// receiver.
///
/// The native side sets it when the fallback analyzer could not process one or
/// more messages (missing provider key, 503, or an `unavailable` response). The
/// affected candidates are *kept* and retried, never treated as "not a
/// transaction"; this flag exists so the state is visible in the UI instead of
/// disappearing silently. Only the native receiver clears it, after a
/// successful analysis round-trip.
class WalletSmsFallbackStatus {
  const WalletSmsFallbackStatus._();

  /// SharedPreferences key, without the platform `flutter.` prefix.
  static const String key = 'wallet_sms_fallback_unavailable';

  /// True while at least one message is still waiting on the fallback analyzer.
  ///
  /// The native receiver stores either `true` or a small JSON counter
  /// (`{"count":…,"lastAtMs":…}`); a non-empty value means "stalled".
  static Future<bool> isUnavailable() async {
    final prefs = await SharedPreferences.getInstance();
    final Object? value = prefs.get(key);
    if (value is bool) return value;
    if (value is String) {
      return value.isNotEmpty && value != 'false';
    }
    return false;
  }
}

/// Mirrors the `wallet_sms_quarantined` state written by the native receiver
/// (V-01/V-02).
///
/// Entries land here when their content cannot be read, when the analyzer
/// returns a status the client cannot interpret, or when the retry budget is
/// spent. Nothing is deleted: the entry waits in the quarantine queue (still
/// sealed) and the Money screen reports that something needs attention.
class WalletSmsQuarantineStatus {
  const WalletSmsQuarantineStatus._();

  /// SharedPreferences key, without the platform `flutter.` prefix.
  static const String key = 'wallet_sms_quarantined';

  /// True while at least one entry is quarantined.
  static Future<bool> isQuarantined() async {
    final prefs = await SharedPreferences.getInstance();
    final Object? value = prefs.get(key);
    if (value is bool) return value;
    if (value is String) {
      return value.isNotEmpty && value != 'false';
    }
    // Fall back to the queue itself: the flag is best-effort, the entries are not.
    return prefs.getKeys().any(
          (String entry) =>
              entry.replaceFirst(_flutterPrefix, '').startsWith(quarantinePrefix),
        );
  }

  /// True when a queue write or removal failed and the native side published a
  /// storage fault (`flutter.wallet_storage_fault`).
  static Future<bool> hasStorageFault() async {
    final prefs = await SharedPreferences.getInstance();
    final Object? value = prefs.get(storageFaultKey);
    return value != null && value.toString().isNotEmpty && value.toString() != 'false';
  }

  /// SharedPreferences key, without the platform `flutter.` prefix.
  static const String storageFaultKey = 'wallet_storage_fault';

  static const String _flutterPrefix = 'flutter.';
  static const String quarantinePrefix = 'pending_wallet_quarantine.';
}

/// Opt-in for detailed wallet notifications (V-03).
///
/// Lock-screen and notification-shade content is private by default: the native
/// receiver only says that a wallet message arrived. Amount and merchant are
/// included only when the user explicitly turns this on, which also means
/// accepting that the values may appear on a locked screen.
class WalletSmsNotificationDetails {
  const WalletSmsNotificationDetails._();

  /// SharedPreferences key, without the platform `flutter.` prefix.
  static const String key = 'wallet_notification_details';

  static Future<bool> isEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(key) ?? false;
  }

  /// Persists the opt-in. Returns false when the write did not reach disk.
  static Future<bool> setEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.setBool(key, enabled);
  }
}

/// Reads and resolves the review queue. Confirming sends the (possibly edited)
/// values through [MoneyRepository] with the review id as the Idempotency-Key,
/// so a retry after a lost response can never create a duplicate.
class PendingWalletReviews {
  PendingWalletReviews(this._repository, {WalletQueueCodec? codec})
      : _codec = codec ?? PlatformWalletQueueCodec();

  static const String keyPrefix = 'pending_wallet_review.';
  static const String _flutterPrefix = 'flutter.';

  final MoneyRepository _repository;
  final WalletQueueCodec _codec;

  Future<List<WalletReviewItem>> load() async {
    final prefs = await SharedPreferences.getInstance();
    // The native receiver writes this store from outside Dart.
    await prefs.reload();
    final items = <WalletReviewItem>[];
    for (final key in prefs.getKeys().map(_withoutFlutterPrefix)) {
      if (!key.startsWith(keyPrefix)) continue;
      final String? entry;
      try {
        entry = await _codec.read(prefs, key);
      } on WalletQueueSecurityException {
        // Unreadable right now (no platform key): keep the entry instead of
        // deleting data on a transient failure.
        continue;
      }
      final item = WalletReviewItem.tryParse(entry);
      if (item == null) {
        // A malformed entry is still the only copy of a financial message, so it
        // is neither listed nor deleted: it stays on disk and the state is
        // published so the Money screen reports it (V-02).
        await _publishQuarantineFlag(prefs);
        continue;
      }
      items.add(item);
    }
    items.sort((a, b) => (a.createdAt ?? 0).compareTo(b.createdAt ?? 0));
    return items;
  }

  /// Publishes the quarantine flag without acknowledging the affected entry.
  Future<void> _publishQuarantineFlag(SharedPreferences prefs) async {
    final Object? previous = prefs.getString(WalletSmsQuarantineStatus.key);
    var count = 0;
    final decoded = previous == null ? null : _decodeOrNull(previous);
    if (decoded is Map<String, dynamic> && decoded['count'] is int) {
      count = decoded['count'] as int;
    }
    await prefs.setString(
      WalletSmsQuarantineStatus.key,
      jsonEncode({
        'count': count + 1,
        'lastAtMs': DateTime.now().millisecondsSinceEpoch,
        'reason': 'MALFORMED_REVIEW',
      }),
    );
  }

  static Object? _decodeOrNull(String? raw) {
    if (raw == null) return null;
    try {
      return jsonDecode(raw);
    } on FormatException {
      return null;
    }
  }

  /// Saves the review item with the user's edits and removes it from the queue.
  Future<void> confirm({
    required WalletReviewItem item,
    required String kind,
    required String amount,
    String? description,
    String? merchant,
  }) async {
    await _repository.createTransaction(
      kind: kind,
      amount: amount,
      currency: item.currency,
      occurredOn: item.occurredOn,
      idempotencyKey: item.id,
      description: description,
      merchant: merchant,
    );
    await _remove(item.id);
  }

  /// Drops a review item without saving it.
  Future<void> discard(String id) => _remove(id);

  Future<void> _remove(String id) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('$keyPrefix$id');
  }

  static String _withoutFlutterPrefix(String key) =>
      key.startsWith(_flutterPrefix)
          ? key.substring(_flutterPrefix.length)
          : key;
}

/// One fallback candidate written by the Android SMS receiver.
class WalletSmsCandidate {
  const WalletSmsCandidate({
    required this.id,
    required this.text,
    required this.receivedAt,
    this.sender,
  });

  final String id;
  final String text;
  final String receivedAt;
  final String? sender;

  static WalletSmsCandidate? tryParse(String? raw) {
    if (raw == null) return null;
    final Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return null;
    }
    if (decoded is! Map<String, dynamic>) return null;

    final id = decoded['id'];
    final receivedAtMs = decoded['receivedAtMs'];
    if (id is! String || id.isEmpty || receivedAtMs is! int) return null;
    return WalletSmsCandidate(
      id: id,
      text: decoded['text'] is String ? decoded['text'] as String : '',
      sender: decoded['sender'] is String ? decoded['sender'] as String : null,
      receivedAt: DateTime.fromMillisecondsSinceEpoch(receivedAtMs)
          .toUtc()
          .toIso8601String(),
    );
  }
}

/// Why a queued candidate must be kept after one analyze attempt (V-01).
///
/// Every non-final outcome keeps the candidate; the reason decides the retry
/// budget and the diagnostic the user sees. None of them is `handled`, so a
/// candidate can never be dropped because of an unexpected status.
enum CandidateRetryReason {
  /// HTTP 503 or `status: unavailable` — the fallback could not run.
  unavailable,

  /// A status the client contract does not define (or a malformed payload).
  unknownStatus,

  /// Transient transport/storage problem.
  notFinal,
}

/// How a queued candidate was resolved by one analyze attempt.
enum CandidateOutcome {
  /// The result was a final answer: the candidate may be removed.
  handled,

  /// The candidate must be kept and retried (see [CandidateDecision.reason]).
  retry,
}

/// The outcome of applying one analyze response, with the reason kept so the
/// retry state machine and the published diagnostics stay aligned.
class CandidateDecision {
  const CandidateDecision._(this.outcome, this.reason);

  const CandidateDecision.handled() : this._(CandidateOutcome.handled, null);

  const CandidateDecision.retry(CandidateRetryReason reason)
      : this._(CandidateOutcome.retry, reason);

  final CandidateOutcome outcome;
  final CandidateRetryReason? reason;
}

/// Retries queued fallback candidates through the backend analyze route and
/// applies the same confidence rules as the receiver: high confidence is saved
/// at once, low confidence becomes a review item.
///
/// Result semantics (F-01/F-02, V-01):
///  * `recognized` — final: auto-save or queue for review, then drop.
///  * `unrecognized` — final: the message is not a transaction, drop.
///  * `unavailable` / HTTP 503 — retryable: keep the candidate and back off.
///  * anything else (missing, non-string, unknown or future status) — retryable
///    within the attempt budget and then quarantined with visible state.
///    Collapsing these states with `unrecognized` silently discarded reviewable
///    financial messages; treating them as terminal deleted the candidate.
class PendingWalletCandidates {
  PendingWalletCandidates(
    this._api,
    this._repository, {
    WalletQueueCodec? codec,
  }) : _codec = codec ?? PlatformWalletQueueCodec();

  static const String keyPrefix = 'pending_wallet_candidate.';
  static const String quarantinePrefix = WalletSmsQuarantineStatus.quarantinePrefix;

  /// Low-confidence results are queued for review, not for analysis again.
  static const String reviewPrefix = 'pending_wallet_review.';
  static const String _flutterPrefix = 'flutter.';
  static const int _maxAttempts = 5;
  /// Quarantine reasons. Only an unreadable payload can heal; a malformed one is
  /// proven unparseable and is never restored to its queue (no revive loop).
  static const String unreadableReason = 'UNREADABLE';
  static const String malformedReason = 'MALFORMED';
  /// A quarantined entry is retried this many times before it stays parked for
  /// the user to resolve (bounded recovery, never an infinite loop).
  static const int _maxQuarantineAttempts = 2;

  /// Sanitized SMS text is never retained longer than this (F-05).
  static const Duration retention = Duration(days: 7);
  static const Duration _backoffStep = Duration(minutes: 5);

  /// User-visible state: the fallback could not analyze one or more messages.
  static const String fallbackUnavailableKey =
      'wallet_sms_fallback_unavailable';

  /// User-visible state: entries that could not be read or interpreted.
  static const String quarantineKey = WalletSmsQuarantineStatus.key;

  /// User-visible state: a queue write or removal did not reach disk (V-02).
  static const String storageFaultKey = 'wallet_storage_fault';

  final ApiClient _api;
  final MoneyRepository _repository;
  final WalletQueueCodec _codec;

  /// Returns how many candidates were resolved. Unresolved candidates stay
  /// queued for a later attempt.
  Future<int> flush() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    final keys = prefs
        .getKeys()
        .map(_withoutFlutterPrefix)
        .where((key) => key.startsWith(keyPrefix))
        .toList()
      ..sort();

    await _retryQuarantined(prefs);

    var resolved = 0;
    for (final key in keys) {
      final String? raw;
      try {
        raw = await _codec.read(prefs, key);
      } on WalletQueueSecurityException {
        // Unreadable rather than absent: park it instead of retrying forever
        // or deleting the message (V-02).
        await _quarantine(prefs, key, unreadableReason);
        continue;
      }
      final decoded = _decodeOrNull(raw);
      if (decoded is! Map<String, dynamic>) {
        await _quarantine(prefs, key, malformedReason);
        continue;
      }
      final candidate = WalletSmsCandidate.tryParse(raw);
      if (candidate == null) {
        await _quarantine(prefs, key, malformedReason);
        continue;
      }
      final receivedAt = decoded['receivedAtMs'];
      if (receivedAt is int &&
          DateTime.now().millisecondsSinceEpoch - receivedAt >
              retention.inMilliseconds) {
        await _removeEntry(prefs, key);
        continue;
      }
      final nextAttempt = decoded['nextAttemptAtMs'];
      if (decoded['blocked'] == true ||
          (nextAttempt is int &&
              nextAttempt > DateTime.now().millisecondsSinceEpoch)) {
        continue;
      }
      final attempts = decoded['attempts'];
      if (attempts is int && attempts >= _maxAttempts) {
        // Budget spent: stop retrying but keep the entry (and make the state
        // visible) instead of deleting the message silently (F-02).
        decoded['blocked'] = true;
        decoded['retryReason'] = CandidateRetryReason.unknownStatus.name;
        await _writeCandidate(prefs, key, decoded);
        await _publishQuarantine(prefs, 'UNKNOWN_STATUS');
        continue;
      }

      try {
        final response = jsonObject(
          await _api.post(
            'ingest/sms/analyze',
            body: {
              'text': candidate.text,
              if (candidate.sender != null) 'sender': candidate.sender,
              'receivedAt': candidate.receivedAt,
            },
          ),
          'SMS analysis',
        );
        final decision = await _applyResult(prefs, key, candidate, response);
        if (decision.outcome == CandidateOutcome.handled) {
          // The replacement record is durable; only now may the candidate go.
          if (await _removeEntry(prefs, key)) {
            await _clearFallbackUnavailable(prefs);
          }
          resolved++;
          continue;
        }
        final reason = decision.reason ?? CandidateRetryReason.notFinal;
        if (!await _retryCandidate(prefs, key, decoded, attempts, reason)) {
          return resolved;
        }
      } on ApiException catch (error) {
        if (_isPermanentRejection(error)) {
          await _removeEntry(prefs, key);
          resolved++;
          continue;
        }
        // 503 SMS_FALLBACK_UNAVAILABLE: the fallback is not configured or is
        // down. This says nothing about the message, so it stays queued.
        final reason = error.statusCode == 503
            ? CandidateRetryReason.unavailable
            : CandidateRetryReason.notFinal;
        if (!await _retryCandidate(prefs, key, decoded, attempts, reason)) {
          return resolved;
        }
      } on Exception {
        await _bumpAttempts(prefs, key, decoded);
        return resolved;
      }
    }
    return resolved;
  }

  /// Applies one analyze response.
  ///
  /// Status handling is exhaustive (V-01): only `recognized` and
  /// `unrecognized` are final answers. A missing, non-string, unknown or
  /// future status keeps the candidate and is retried within the budget, then
  /// quarantined with visible state.
  Future<CandidateDecision> _applyResult(
    SharedPreferences prefs,
    String key,
    WalletSmsCandidate candidate,
    Map<String, dynamic> response,
  ) async {
    final status = response['status'];
    if (status is! String || status.isEmpty) {
      return const CandidateDecision.retry(CandidateRetryReason.unknownStatus);
    }
    switch (status) {
      case 'unavailable':
        // The fallback could not run: never a verdict on the message (F-02).
        return const CandidateDecision.retry(CandidateRetryReason.unavailable);
      case 'unrecognized':
        // A final answer: the message is not a transaction.
        return const CandidateDecision.handled();
      case 'recognized':
        break;
      default:
        // Unknown/future status: keep the candidate (V-01).
        return const CandidateDecision.retry(CandidateRetryReason.unknownStatus);
    }

    final transaction = response['transaction'];
    if (transaction is! Map<String, dynamic>) {
      return const CandidateDecision.retry(CandidateRetryReason.notFinal);
    }

    final reviewRaw = jsonEncode({
      'id': candidate.id,
      'kind': transaction['kind'],
      'amount': transaction['amount'],
      'currency': transaction['currency'] ?? 'EGP',
      'occurredOn': transaction['occurredOn'],
      'description': transaction['description'],
      'merchant': transaction['merchant'],
      'sender': candidate.sender,
      'text': candidate.text,
      'createdAt': DateTime.now().millisecondsSinceEpoch,
    });
    final review = WalletReviewItem.tryParse(reviewRaw);
    if (review == null) {
      return const CandidateDecision.retry(CandidateRetryReason.notFinal);
    }

    if (response['confidence'] == 'high') {
      // High confidence may auto-save, with the candidate id as idempotency key.
      try {
        await _repository.createTransaction(
          kind: review.kind,
          amount: review.amount,
          currency: review.currency,
          occurredOn: review.occurredOn,
          idempotencyKey: review.id,
          description: review.description,
          merchant: review.merchant,
        );
        return const CandidateDecision.handled();
      } on Exception {
        // Could not save now: fall through and keep it for review instead.
      }
    }

    // Low confidence requires user confirmation in the Money review flow. On a
    // real device the plugin stores this as `flutter.pending_wallet_review.<id>`,
    // the same key format the native receiver uses. The candidate is only
    // dropped once that write is confirmed (V-02).
    try {
      await _codec.write(
        prefs,
        '$reviewPrefix${review.id}',
        reviewRaw,
      );
      return const CandidateDecision.handled();
    } on WalletQueueSecurityException {
      // Without protection the entry must not be written: retry the candidate.
      return const CandidateDecision.retry(CandidateRetryReason.notFinal);
    }
  }

  /// Applies bounded backoff. Returns true when the flush loop can continue
  /// with the next candidate.
  Future<bool> _retryCandidate(
    SharedPreferences prefs,
    String key,
    Map<String, dynamic> decoded,
    Object? attempts,
    CandidateRetryReason reason,
  ) async {
    final next = attempts is int ? attempts + 1 : 1;
    decoded['attempts'] = next;
    decoded['retryReason'] = reason.name;
    if (next >= _maxAttempts) {
      // Out of attempts: stop retrying but keep the entry visible instead of
      // deleting the message silently.
      decoded['blocked'] = true;
      await _writeCandidate(prefs, key, decoded);
      await _publishReason(prefs, reason);
      return true;
    }
    decoded['nextAttemptAtMs'] = DateTime.now().millisecondsSinceEpoch +
        _backoffStep.inMilliseconds * next;
    await _writeCandidate(prefs, key, decoded);
    await _publishReason(prefs, reason);
    return false;
  }

  Future<void> _bumpAttempts(
    SharedPreferences prefs,
    String key,
    Map<String, dynamic> decoded,
  ) async {
    final attempts = decoded['attempts'];
    decoded['attempts'] = attempts is int ? attempts + 1 : 1;
    await _writeCandidate(prefs, key, decoded);
  }

  /// Publishes the diagnostic that matches [reason].
  Future<void> _publishReason(
    SharedPreferences prefs,
    CandidateRetryReason reason,
  ) async {
    switch (reason) {
      case CandidateRetryReason.unavailable:
        await _publishFallbackUnavailable(prefs);
      case CandidateRetryReason.unknownStatus:
        await _publishQuarantine(prefs, 'UNKNOWN_STATUS');
      case CandidateRetryReason.notFinal:
        break;
    }
  }

  /// Always stores the candidate sealed with the device key (F-05).
  Future<void> _writeCandidate(
    SharedPreferences prefs,
    String key,
    Map<String, dynamic> decoded,
  ) async {
    try {
      await _codec.write(prefs, key, jsonEncode(decoded));
    } on WalletQueueSecurityException {
      // Nothing safer is available: leave the previous entry untouched, but
      // report that the queue could not be updated (V-02).
      await _publishStorageFault(prefs);
    }
  }

  /// Parks one entry instead of retrying it forever or deleting it (V-02).
  ///
  /// The sealed value is preserved verbatim, so a transient key problem can
  /// still be resolved later; only the queue it lives in changes.
  Future<void> _quarantine(
    SharedPreferences prefs,
    String key,
    String reason,
  ) async {
    final String? stored = prefs.getString(key);
    if (stored == null) return;
    final envelope = jsonEncode({
      'origin': keyPrefix,
      'reason': reason,
      'attempts': 0,
      'payload': stored,
      'quarantinedAtMs': DateTime.now().millisecondsSinceEpoch,
    });
    final target = '$quarantinePrefix${key.substring(keyPrefix.length)}';
    try {
      // Write the quarantine record first, remove the source after (V-02).
      await _codec.write(prefs, target, envelope);
    } on WalletQueueSecurityException {
      // Cannot even re-seal: leave the entry where it is and stop retrying it
      // this round rather than losing it.
      await _publishQuarantine(prefs, 'WRITE_FAILED');
      return;
    }
    await _removeEntry(prefs, key);
    await _publishQuarantine(prefs, reason);
  }

  /// Bounded recovery for quarantined entries.
  ///
  /// The preserved payload is re-checked with the device key. When it is
  /// readable again the original (still sealed) value goes back to its origin
  /// queue exactly once; otherwise the attempt counter advances and the entry
  /// stays parked for the user. Never an infinite retry loop (V-02): only
  /// `UNREADABLE` entries can heal, because a `MALFORMED` payload would fail to
  /// parse again and bounce between the two queues forever.
  ///
  /// Quarantined entries also expire on the same retention window as queued
  /// candidates (F-05), since they still contain the sanitized message.
  Future<void> _retryQuarantined(SharedPreferences prefs) async {
    final keys = prefs
        .getKeys()
        .map(_withoutFlutterPrefix)
        .where((key) => key.startsWith(quarantinePrefix))
        .toList();
    if (keys.isEmpty) return;
    for (final key in keys) {
      final String? raw;
      try {
        raw = await _codec.read(prefs, key);
      } on WalletQueueSecurityException {
        continue;
      }
      final decoded = _decodeOrNull(raw);
      if (decoded is! Map<String, dynamic>) continue;

      final quarantinedAt = decoded['quarantinedAtMs'];
      if (quarantinedAt is int &&
          DateTime.now().millisecondsSinceEpoch - quarantinedAt >
              retention.inMilliseconds) {
        await _removeEntry(prefs, key);
        continue;
      }

      if (decoded['reason'] != unreadableReason) continue;

      final attempts = decoded['attempts'];
      final used = attempts is int ? attempts : 0;
      if (used >= _maxQuarantineAttempts) continue;

      final payload = decoded['payload'];
      final origin = decoded['origin'];
      if (payload is! String ||
          origin is! String ||
          !origin.startsWith('pending_wallet_')) {
        continue;
      }

      String? readable;
      try {
        readable = await _codec.unseal(payload);
      } on WalletQueueSecurityException {
        continue;
      }

      if (readable == null) {
        // Still unreadable: record the attempt and leave it parked.
        decoded['attempts'] = used + 1;
        try {
          await _codec.write(prefs, key, jsonEncode(decoded));
        } on WalletQueueSecurityException {
          // Leave the previous envelope untouched.
        }
        continue;
      }

      // Readable again: hand the original sealed value back to its origin queue.
      final target = '$origin${key.substring(quarantinePrefix.length)}';
      if (!await prefs.setString(target, payload)) {
        await _publishQuarantine(prefs, 'WRITE_FAILED');
        continue;
      }
      await _removeEntry(prefs, key);
    }
    if (!prefs.getKeys().any(
          (String entry) =>
              entry.replaceFirst(_flutterPrefix, '').startsWith(quarantinePrefix),
        )) {
      await prefs.remove(quarantineKey);
    }
  }

  /// Removes one entry and verifies the removal reached disk (V-02). A silent
  /// failure would resurrect the entry on the next read, so it is reported.
  Future<bool> _removeEntry(SharedPreferences prefs, String key) async {
    final removed = await prefs.remove(key);
    if (!removed) {
      await _publishStorageFault(prefs);
    }
    return removed;
  }

  /// Publishes a storage fault so a failed write is visible, not silent.
  Future<void> _publishStorageFault(SharedPreferences prefs) async {
    await prefs.setString(
      storageFaultKey,
      DateTime.now().millisecondsSinceEpoch.toString(),
    );
  }

  Future<void> _publishFallbackUnavailable(SharedPreferences prefs) async {
    await _publishCounter(prefs, fallbackUnavailableKey);
  }

  Future<void> _publishQuarantine(SharedPreferences prefs, String reason) async {
    await _publishCounter(prefs, quarantineKey, reason: reason);
  }

  Future<void> _publishCounter(
    SharedPreferences prefs,
    String key, {
    String? reason,
  }) async {
    final previous = prefs.getString(key);
    var count = 0;
    if (previous != null) {
      final decoded = _decodeOrNull(previous);
      if (decoded is Map<String, dynamic> && decoded['count'] is int) {
        count = decoded['count'] as int;
      }
    }
    await prefs.setString(
      key,
      jsonEncode({
        'count': count + 1,
        'lastAtMs': DateTime.now().millisecondsSinceEpoch,
        if (reason != null) 'reason': reason,
      }),
    );
  }

  Future<void> _clearFallbackUnavailable(SharedPreferences prefs) async {
    if (prefs.containsKey(fallbackUnavailableKey)) {
      await prefs.remove(fallbackUnavailableKey);
    }
  }

  bool _isPermanentRejection(ApiException error) =>
      error.statusCode == 400 || error.statusCode == 422;

  static String _withoutFlutterPrefix(String key) =>
      key.startsWith(_flutterPrefix)
          ? key.substring(_flutterPrefix.length)
          : key;

  static Object? _decodeOrNull(String? raw) {
    if (raw == null) return null;
    try {
      return jsonDecode(raw);
    } on FormatException {
      return null;
    }
  }
}
