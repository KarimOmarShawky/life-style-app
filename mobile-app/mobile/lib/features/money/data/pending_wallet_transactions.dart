import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';
import 'package:lifestyle_mobile/features/money/data/wallet_queue_codec.dart';

/// Wallet and bank transactions that the Android SMS receiver stored while the
/// app was not running.
///
/// The receiver writes one SharedPreferences entry per transaction
/// (`pending_wallet_tx.<uuid>`). This class sends them through [MoneyRepository],
/// so token refresh is handled by [ApiClient]. The entry id is used as the
/// Idempotency-Key, so a retry after a lost response cannot create a duplicate.
class PendingWalletTransactions {
  PendingWalletTransactions(this._repository, {WalletQueueCodec? codec})
      : _codec = codec ?? PlatformWalletQueueCodec();

  static const String keyPrefix = 'pending_wallet_tx.';
  // Marker has no SMS content and is shared with the native receiver.
  static const String blockedPrefix = 'wallet_tx_rejected.';
  static const String _flutterPrefix = 'flutter.';

  final MoneyRepository _repository;
  final WalletQueueCodec _codec;

  /// Sends queued transactions that are not blocked by a prior rejection.
  /// Rejected entries remain parked; returns how many were stored.
  /// Older entries may still use the legacy plaintext storage format.
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
      await prefs.reload();
      final id = key.substring(keyPrefix.length);
      final blockedKey = '$blockedPrefix$id';
      final holdKey = 'wallet_legacy_hold.$id';
      if (prefs.containsKey(blockedKey) || prefs.containsKey(holdKey)) continue;
      if (prefs.containsKey('pending_wallet_quarantine.$id')) {
        // Two records with the same ID may be unrelated; keep both locked.
        try {
          if (!await prefs.setString(holdKey, 'HELD')) {
            await _publishStorageFault(prefs);
          }
        } on Object {
          await _publishStorageFault(prefs);
        }
        continue;
      }
      // The native receiver stores this entry sealed with the device key.
      final String? entry;
      try {
        entry = await _codec.read(prefs, key);
      } on WalletQueueSecurityException {
        // Unreadable right now: keep the entry instead of deleting it.
        continue;
      }
      final item = PendingWalletTransaction.tryParse(entry);
      if (item == null) {
        // A damaged or temporarily unreadable entry may be the only copy.
        // Do not delete it or infer its owner; leave it for safe recovery.
        continue;
      }
      if (item.id != id) {
        // A misplaced payload cannot safely supply the idempotency key.
        try {
          if (!await prefs.setString(holdKey, 'HELD')) {
            await _publishStorageFault(prefs);
          }
        } on Object {
          await _publishStorageFault(prefs);
        }
        continue;
      }
      await prefs.reload();
      if (prefs.containsKey(blockedKey) ||
          prefs.containsKey(holdKey) ||
          prefs.containsKey('pending_wallet_quarantine.$id')) continue;
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
          // Preserve the original (legacy entries may be plaintext) and park it.
          if (!await _markRejected(prefs, blockedKey)) break;
          continue;
        }
        // Expired session, network or server problem: keep the queue for later.
        break;
      } on Exception {
        break;
      }
      // Native processing may have parked this item while the request was in flight.
      await prefs.reload();
      if (prefs.containsKey(blockedKey) ||
          prefs.containsKey(holdKey) ||
          prefs.containsKey('pending_wallet_quarantine.$id')) continue;
      stored++;
      await prefs.remove(key);
    }
    return stored;
  }

  Future<void> _publishStorageFault(SharedPreferences prefs) async {
    try {
      await prefs.setString('wallet_storage_fault',
          DateTime.now().millisecondsSinceEpoch.toString());
    } on Object {
      // The fault indicator is best effort when the preference store is broken.
    }
  }

  Future<bool> _markRejected(SharedPreferences prefs, String blockedKey) async {
    final bool committed;
    try {
      committed = await prefs.setString(blockedKey, 'REJECTED');
    } on Object {
      await _publishStorageFault(prefs);
      return false;
    }
    if (!committed) {
      await _publishStorageFault(prefs);
      return false;
    }
    // The marker itself is authoritative if this best-effort notice fails.
    try {
      final published = await prefs.setString(
          'wallet_sms_quarantined',
          jsonEncode({
            'reason': 'REJECTED_TRANSACTION',
            'count': 1,
            'lastAtMs': DateTime.now().millisecondsSinceEpoch,
          }));
      if (!published) await _publishStorageFault(prefs);
    } on Object {
      await _publishStorageFault(prefs);
    }
    return true;
  }

  static String _withoutFlutterPrefix(String key) =>
      key.startsWith(_flutterPrefix)
          ? key.substring(_flutterPrefix.length)
          : key;

  static bool _isPermanentRejection(ApiException error) =>
      error.statusCode == 400 ||
      error.statusCode == 422 ||
      error.statusCode == 409;
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
