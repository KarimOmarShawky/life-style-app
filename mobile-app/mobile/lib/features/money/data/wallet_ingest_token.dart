import 'dart:developer' as developer;

import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';

/// A session-bound token that lets the Android SMS receiver save wallet transactions while the
/// app is closed. The receiver reads it from SharedPreferences, where Android stores this key as
/// `flutter.lifestyle.wallet_ingest_token.v1`.
///
/// The backend ties the token to the login session, so signing out ends it. Turning SMS capture
/// off revokes it. The token can only create transactions and ask the backend SMS fallback to
/// analyze candidates.
class WalletIngestToken {
  WalletIngestToken(this._api);

  static const String storageKey = 'lifestyle.wallet_ingest_token.v1';
  static const String smsSyncKey = 'sms_sync_enabled';

  final ApiClient _api;

  /// Issues a token when SMS capture is on and none is stored. With [force], a new token is always
  /// issued and replaces the stored one.
  Future<void> ensure({bool force = false}) async {
    final prefs = await SharedPreferences.getInstance();
    if (!(prefs.getBool(smsSyncKey) ?? false)) return;
    final stored = prefs.getString(storageKey);
    if (!force && stored != null && stored.isNotEmpty) return;
    try {
      final response = jsonObject(
        await _api.post('ingest/token'),
        'ingest token',
      );
      await prefs.setString(storageKey, jsonString(response, 'token'));
    } on Exception catch (error) {
      // Offline or signed out. The next app start or resume tries again.
      developer.log(
        'Wallet ingest token was not issued: $error',
        name: 'WalletIngestToken',
      );
    }
  }

  /// Removes the local copy first, so the phone stops using the token even if the request fails.
  Future<void> revoke() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(storageKey);
    try {
      await _api.delete('ingest/token');
    } on Exception catch (error) {
      developer.log(
        'Wallet ingest token was not revoked: $error',
        name: 'WalletIngestToken',
      );
    }
  }

  /// Removes the local copy only. Used at sign-out, when the session itself is revoked.
  static Future<void> clearLocal() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(storageKey);
  }
}
