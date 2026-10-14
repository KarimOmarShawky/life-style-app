import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';

/// Wallet and bank transactions that the Android SMS receiver stored while the
/// app was not running.
///
/// The receiver writes one SharedPreferences entry per transaction
/// (`pending_wallet_tx.<uuid>`). This class sends them through [MoneyRepository],
/// so token refresh is handled by [ApiClient]. The entry id is used as the
/// Idempotency-Key, so a retry after a lost response cannot create a duplicate.
class PendingWalletTransactions {
  PendingWalletTransactions(this._repository);

  static const String keyPrefix = 'pending_wallet_tx.';
  static const String _flutterPrefix = 'flutter.';

  final MoneyRepository _repository;

  /// Sends every queued transaction that the API accepts or permanently rejects.
  /// Returns how many transactions were stored.
  Future<int> flush() async {
    final prefs = await SharedPreferences.getInstance();
    // The native SMS receiver writes to this store from outside Dart, and the plugin
    // caches values. Reload so entries written while the app was running are visible.
    await prefs.reload();
    final keys = prefs
        .getKeys()
        .map(_withoutFlutterPrefix)
        .where((key) => key.startsWith(keyPrefix))
        .toList()
      ..sort();

    var stored = 0;
    for (final key in keys) {
      final item = PendingWalletTransaction.tryParse(prefs.getString(key));
      if (item == null) {
        await prefs.remove(key);
        continue;
      }
      try {
        await _repository.createTransaction(
          kind: item.kind,
          amount: item.amount,
          currency: item.currency,
          occurredOn: item.occurredOn,
          idempotencyKey: item.id,
          description: item.description,
          merchant: item.merchant,
        );
      } on ApiException catch (error) {
        if (_isPermanentRejection(error)) {
          await prefs.remove(key);
          continue;
        }
        // Expired session, network or server problem: keep the queue for later.
        break;
      } on Exception {
        break;
      }
      stored++;
      await prefs.remove(key);
    }
    return stored;
  }

  static String _withoutFlutterPrefix(String key) =>
      key.startsWith(_flutterPrefix)
          ? key.substring(_flutterPrefix.length)
          : key;

  static bool _isPermanentRejection(ApiException error) =>
      error.statusCode == 400 ||
      error.statusCode == 422 ||
      (error.statusCode == 409 && error.code == 'IDEMPOTENCY_KEY_REUSED');
}

/// One transaction written by the native SMS receiver.
class PendingWalletTransaction {
  const PendingWalletTransaction({
    required this.id,
    required this.kind,
    required this.amount,
    required this.currency,
    required this.occurredOn,
    this.description,
    this.merchant,
  });

  final String id;
  final String kind;
  final String amount;
  final String currency;
  final String occurredOn;
  final String? description;
  final String? merchant;

  /// Returns null when the stored value is missing or malformed.
  static PendingWalletTransaction? tryParse(String? raw) {
    if (raw == null) return null;
    final decoded = _decodeOrNull(raw);
    if (decoded is! Map<String, dynamic>) return null;

    final id = decoded['id'];
    final kind = decoded['kind'];
    final amount = decoded['amount'];
    final occurredOn = decoded['occurredOn'];
    if (id is! String ||
        kind is! String ||
        amount is! String ||
        occurredOn is! String ||
        id.isEmpty ||
        (kind != 'expense' && kind != 'income')) {
      return null;
    }

    final currency = decoded['currency'];
    final description = decoded['description'];
    final merchant = decoded['merchant'];
    return PendingWalletTransaction(
      id: id,
      kind: kind,
      amount: amount,
      currency: currency is String && currency.isNotEmpty ? currency : 'EGP',
      occurredOn: occurredOn,
      description:
          description is String && description.isNotEmpty ? description : null,
      merchant: merchant is String && merchant.isNotEmpty ? merchant : null,
    );
  }

  static Object? _decodeOrNull(String raw) {
    try {
      return jsonDecode(raw);
    } on FormatException {
      return null;
    }
  }
}
