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
        await prefs.remove(key);
        continue;
      }
      items.add(item);
    }
    items.sort((a, b) => (a.createdAt ?? 0).compareTo(b.createdAt ?? 0));
    return items;
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

/// How a queued candidate was resolved by one analyze attempt.
enum CandidateOutcome {
  /// The result was a final answer: the candidate may be removed.
  handled,

  /// The fallback could not answer (or the payload was unusable): keep the
  /// candidate and retry later.
  retry,
}

/// Retries queued fallback candidates through the backend analyze route and
/// applies the same confidence rules as the receiver: high confidence is saved
/// at once, low confidence becomes a review item.
///
/// Result semantics (F-01/F-02):
///  * `recognized` — final: auto-save or queue for review, then drop.
///  * `unrecognized` — final: the message is not a transaction, drop.
///  * `unavailable` / HTTP 503 — retryable: keep the candidate and back off.
///    Collapsing this state with `unrecognized` silently discarded reviewable
///    financial messages.
class PendingWalletCandidates {
  PendingWalletCandidates(
    this._api,
    this._repository, {
    WalletQueueCodec? codec,
  }) : _codec = codec ?? PlatformWalletQueueCodec();

  static const String keyPrefix = 'pending_wallet_candidate.';
  static const String _flutterPrefix = 'flutter.';
  static const int _maxAttempts = 5;

  /// Sanitized SMS text is never retained longer than this (F-05).
  static const Duration retention = Duration(days: 7);
  static const Duration _backoffStep = Duration(minutes: 5);

  /// User-visible state: the fallback could not analyze one or more messages.
  static const String fallbackUnavailableKey =
      'wallet_sms_fallback_unavailable';

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

    var resolved = 0;
    for (final key in keys) {
      final String? raw;
      try {
        raw = await _codec.read(prefs, key);
      } on WalletQueueSecurityException {
        continue;
      }
      final decoded = _decodeOrNull(raw);
      if (decoded is! Map<String, dynamic>) {
        await prefs.remove(key);
        continue;
      }
      final candidate = WalletSmsCandidate.tryParse(raw);
      if (candidate == null) {
        await prefs.remove(key);
        continue;
      }
      final receivedAt = decoded['receivedAtMs'];
      if (receivedAt is int &&
          DateTime.now().millisecondsSinceEpoch - receivedAt >
              retention.inMilliseconds) {
        await prefs.remove(key);
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
        await _writeCandidate(prefs, key, decoded);
        await _publishFallbackUnavailable(prefs);
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
        final outcome = await _applyResult(prefs, key, candidate, response);
        if (outcome == CandidateOutcome.handled) {
          await prefs.remove(key);
          await _clearFallbackUnavailable(prefs);
          resolved++;
          continue;
        }
        if (!await _retryCandidate(prefs, key, decoded, attempts,
            unavailable: true)) {
          return resolved;
        }
      } on ApiException catch (error) {
        if (_isPermanentRejection(error)) {
          await prefs.remove(key);
          resolved++;
          continue;
        }
        // 503 SMS_FALLBACK_UNAVAILABLE: the fallback is not configured or is
        // down. This says nothing about the message, so it stays queued.
        final unavailable = error.statusCode == 503;
        if (!await _retryCandidate(prefs, key, decoded, attempts,
            unavailable: unavailable)) {
          return resolved;
        }
      } on Exception {
        await _bumpAttempts(prefs, key, decoded);
        return resolved;
      }
    }
    return resolved;
  }

  Future<CandidateOutcome> _applyResult(
    SharedPreferences prefs,
    String key,
    WalletSmsCandidate candidate,
    Map<String, dynamic> response,
  ) async {
    final status = response['status'];
    // "unavailable" means the fallback could not run: never a verdict on the
    // message, so the candidate must survive (F-02).
    if (status == 'unavailable') return CandidateOutcome.retry;
    if (status != 'recognized') return CandidateOutcome.handled;

    final transaction = response['transaction'];
    if (transaction is! Map<String, dynamic>) return CandidateOutcome.retry;

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
    if (review == null) return CandidateOutcome.retry;

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
        return CandidateOutcome.handled;
      } on Exception {
        // Could not save now: fall through and keep it for review instead.
      }
    }

    // Low confidence requires user confirmation in the Money review flow. On a
    // real device the plugin stores this as `flutter.pending_wallet_review.<id>`,
    // the same key format the native receiver uses.
    try {
      await _codec.write(
        prefs,
        '${PendingWalletReviews.keyPrefix}${review.id}',
        reviewRaw,
      );
      return CandidateOutcome.handled;
    } on WalletQueueSecurityException {
      // Without protection the entry must not be written: retry the candidate.
      return CandidateOutcome.retry;
    }
  }

  /// Applies bounded backoff. Returns true when the flush loop can continue
  /// with the next candidate.
  Future<bool> _retryCandidate(
    SharedPreferences prefs,
    String key,
    Map<String, dynamic> decoded,
    Object? attempts, {
    required bool unavailable,
  }) async {
    final next = attempts is int ? attempts + 1 : 1;
    decoded['attempts'] = next;
    if (next >= _maxAttempts) {
      // Out of attempts: stop retrying but keep the entry visible instead of
      // deleting the message silently.
      decoded['blocked'] = true;
    } else {
      decoded['nextAttemptAtMs'] = DateTime.now().millisecondsSinceEpoch +
          _backoffStep.inMilliseconds * next;
    }
    await _writeCandidate(prefs, key, decoded);
    if (unavailable) await _publishFallbackUnavailable(prefs);
    return next >= _maxAttempts;
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

  /// Always stores the candidate sealed with the device key (F-05).
  Future<void> _writeCandidate(
    SharedPreferences prefs,
    String key,
    Map<String, dynamic> decoded,
  ) async {
    try {
      await _codec.write(prefs, key, jsonEncode(decoded));
    } on WalletQueueSecurityException {
      // Nothing safer is available: leave the previous entry untouched.
    }
  }

  Future<void> _publishFallbackUnavailable(SharedPreferences prefs) async {
    final previous = prefs.getString(fallbackUnavailableKey);
    var count = 0;
    if (previous != null) {
      final decoded = _decodeOrNull(previous);
      if (decoded is Map<String, dynamic> && decoded['count'] is int) {
        count = decoded['count'] as int;
      }
    }
    await prefs.setString(
      fallbackUnavailableKey,
      jsonEncode({
        'count': count + 1,
        'lastAtMs': DateTime.now().millisecondsSinceEpoch,
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
