import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';

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

/// Reads and resolves the review queue. Confirming sends the (possibly edited)
/// values through [MoneyRepository] with the review id as the Idempotency-Key,
/// so a retry after a lost response can never create a duplicate.
class PendingWalletReviews {
  PendingWalletReviews(this._repository);

  static const String keyPrefix = 'pending_wallet_review.';
  static const String _flutterPrefix = 'flutter.';

  final MoneyRepository _repository;

  Future<List<WalletReviewItem>> load() async {
    final prefs = await SharedPreferences.getInstance();
    // The native receiver writes this store from outside Dart.
    await prefs.reload();
    final items = <WalletReviewItem>[];
    for (final key in prefs.getKeys().map(_withoutFlutterPrefix)) {
      if (!key.startsWith(keyPrefix)) continue;
      final item = WalletReviewItem.tryParse(prefs.getString(key));
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

  static String _withoutFlutterPrefix(String key) => key.startsWith(_flutterPrefix)
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

/// Retries queued fallback candidates through the backend analyze route and
/// applies the same confidence rules as the receiver: high confidence is saved
/// at once, low confidence becomes a review item, anything else is dropped.
class PendingWalletCandidates {
  PendingWalletCandidates(this._api, this._repository);

  static const String keyPrefix = 'pending_wallet_candidate.';
  static const String _flutterPrefix = 'flutter.';
  static const int _maxAttempts = 5;

  final ApiClient _api;
  final MoneyRepository _repository;

  /// Returns how many candidates were resolved (saved, queued for review, or
  /// dropped). Unresolved candidates stay queued for a later attempt.
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
      final raw = prefs.getString(key);
      final decoded = _decodeOrNull(raw);
      if (decoded is! Map<String, dynamic>) {
        await prefs.remove(key);
        continue;
      }
      final attempts = decoded['attempts'];
      if (attempts is int && attempts >= _maxAttempts) {
        await prefs.remove(key);
        continue;
      }
      final candidate = WalletSmsCandidate.tryParse(raw);
      if (candidate == null) {
        await prefs.remove(key);
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
        await _applyResult(prefs, key, candidate, response);
        resolved++;
      } on ApiException catch (error) {
        if (_isPermanentRejection(error)) {
          await prefs.remove(key);
          resolved++;
          continue;
        }
        // Expired session, network or server problem: keep the queue for later.
        await _bumpAttempts(prefs, key, decoded);
        break;
      } on Exception {
        await _bumpAttempts(prefs, key, decoded);
        break;
      }
    }
    return resolved;
  }

  Future<void> _applyResult(
    SharedPreferences prefs,
    String key,
    WalletSmsCandidate candidate,
    Map<String, dynamic> response,
  ) async {
    final status = response['status'];
    if (status != 'recognized') {
      // "unrecognized" or "unavailable": not a transaction we can log.
      await prefs.remove(key);
      return;
    }
    final transaction = response['transaction'];
    if (transaction is! Map<String, dynamic>) {
      await prefs.remove(key);
      return;
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
      await prefs.remove(key);
      return;
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
        await prefs.remove(key);
        return;
      } on Exception {
        // Could not save now: fall through and keep it for review instead.
      }
    }

    // Low confidence requires user confirmation in the Money review flow. On a
    // real device the plugin stores this as `flutter.pending_wallet_review.<id>`,
    // the same key format the native receiver uses.
    await prefs.setString('${PendingWalletReviews.keyPrefix}${review.id}', reviewRaw);
    await prefs.remove(key);
  }

  Future<void> _bumpAttempts(
    SharedPreferences prefs,
    String key,
    Map<String, dynamic> decoded,
  ) async {
    final attempts = decoded['attempts'];
    decoded['attempts'] = attempts is int ? attempts + 1 : 1;
    await prefs.setString(key, jsonEncode(decoded));
  }

  bool _isPermanentRejection(ApiException error) =>
      error.statusCode == 400 || error.statusCode == 422;

  static String _withoutFlutterPrefix(String key) => key.startsWith(_flutterPrefix)
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
