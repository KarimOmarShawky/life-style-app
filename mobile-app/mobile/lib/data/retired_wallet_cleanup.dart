import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Removes only data belonging to the retired wallet. Called on every launch,
/// so a failed or interrupted cleanup is attempted again on the next launch.
class RetiredWalletCleanup {
  static const _keys = <String>{
    'sms_sync_enabled',
    'wallet_notification_details',
    'wallet_trusted_senders',
    'wallet_sms_fallback_unavailable',
    'wallet_sms_quarantined',
    'wallet_storage_fault',
    'lifestyle.wallet_ingest_token.v1',
  };
  static const _prefixes = <String>[
    'pending_wallet_tx.',
    'pending_wallet_candidate.',
    'pending_wallet_review.',
    'pending_wallet_quarantine.',
    'wallet_legacy_hold.',
    'wallet_tx_rejected.',
  ];
  static const _secureKey = 'lifestyle.wallet_ingest_token.v1';

  static bool isRetiredKey(String key) =>
      _keys.contains(key) || _prefixes.any(key.startsWith);

  static Future<void> _cleanupAndroid() async {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      const channel =
          MethodChannel('com.example.lifestyle_mobile/native_voice');
      await channel.invokeMethod<void>('cleanupRetiredWallet');
    }
  }

  /// False indicates incomplete cleanup. Independent stores are attempted even
  /// when one fails; never delete all secure storage or all preferences.
  static Future<bool> run({
    Future<SharedPreferences> Function()? preferences,
    Future<void> Function()? deleteSecureToken,
    Future<void> Function()? cleanupNative,
  }) async {
    var success = true;
    try {
      final prefs = await (preferences ?? SharedPreferences.getInstance)();
      for (final key in prefs.getKeys().where(isRetiredKey).toList()) {
        if (!await prefs.remove(key)) success = false;
      }
    } catch (_) {
      success = false;
    }
    try {
      await (deleteSecureToken ??
          () => const FlutterSecureStorage().delete(key: _secureKey))();
    } catch (_) {
      success = false;
    }
    try {
      await (cleanupNative ?? _cleanupAndroid)();
    } catch (_) {
      success = false;
    }
    return success;
  }
}
