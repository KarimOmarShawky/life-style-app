import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';

abstract class WalletCredentialStore {
  Future<bool> hasToken();
  Future<void> write(String token);
  Future<void> clear();
}

/// Android native receiver and Flutter share device-bound Keystore ciphertext.
/// Other native targets use the existing secure-storage plugin. Never preferences.
class PlatformWalletCredentialStore implements WalletCredentialStore {
  static const _channel = MethodChannel(
    'com.example.lifestyle_mobile/native_voice',
  );
  static const _secure = FlutterSecureStorage();
  Future<void> _migrateOtherPlatform() async {
    final prefs = await SharedPreferences.getInstance();
    final legacy = prefs.getString(WalletIngestToken.storageKey);
    if (legacy != null) {
      await _secure.write(key: WalletIngestToken.storageKey, value: legacy);
      await prefs.remove(WalletIngestToken.storageKey);
    }
  }

  @override
  Future<bool> hasToken() async {
    if (Platform.isAndroid)
      return await _channel.invokeMethod<bool>('hasWalletIngestToken') ?? false;
    await _migrateOtherPlatform();
    return (await _secure.read(
          key: WalletIngestToken.storageKey,
        ))
            ?.isNotEmpty ??
        false;
  }

  @override
  Future<void> write(String token) async {
    if (Platform.isAndroid) {
      await _channel.invokeMethod<void>('storeWalletIngestToken', {
        'token': token,
      });
    } else {
      await _secure.write(key: WalletIngestToken.storageKey, value: token);
      await (await SharedPreferences.getInstance()).remove(
        WalletIngestToken.storageKey,
      );
    }
  }

  @override
  Future<void> clear() async {
    if (Platform.isAndroid) {
      await _channel.invokeMethod<void>('clearWalletIngestToken');
    } else {
      await _secure.delete(key: WalletIngestToken.storageKey);
      await (await SharedPreferences.getInstance()).remove(
        WalletIngestToken.storageKey,
      );
    }
  }
}

/// Session-bound ingest token; revocation remains authoritative on the backend.
class WalletIngestToken {
  WalletIngestToken(this._api, {WalletCredentialStore? credentials})
      : _credentials = credentials ?? PlatformWalletCredentialStore();
  static const storageKey =
      'lifestyle.wallet_ingest_token.v1'; // legacy migration key
  static const smsSyncKey = 'sms_sync_enabled';
  final ApiClient _api;
  final WalletCredentialStore _credentials;

  Future<void> ensure({bool force = false}) async {
    final prefs = await SharedPreferences.getInstance();
    if (!(prefs.getBool(smsSyncKey) ?? false)) return;
    if (!force && await _credentials.hasToken()) return;
    // Fail visibly to the caller on credential-store failures; never fall back to plaintext.
    final response = jsonObject(
      await _api.post('ingest/token'),
      'ingest token',
    );
    await _credentials.write(jsonString(response, 'token'));
  }

  Future<void> revoke() async {
    await _credentials.clear();
    await _api.delete('ingest/token');
  }

  static Future<void> clearLocal({WalletCredentialStore? credentials}) =>
      (credentials ?? PlatformWalletCredentialStore()).clear();
}
