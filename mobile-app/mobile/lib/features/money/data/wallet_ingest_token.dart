import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';

abstract class WalletCredentialStore {
  /// Unbound legacy credentials must not be attributed to the current account.
  Future<bool> hasTokenFor(String ownerId);
  Future<void> writeBound(String token, String ownerId);
  Future<void> clearIfMatches(String token);
  Future<void> clear();
}

/// The Android receiver shares a single device-bound Keystore ciphertext.
/// Other native targets store the same pair in secure storage, never preferences.
class PlatformWalletCredentialStore implements WalletCredentialStore {
  static const _channel = MethodChannel(
    'com.example.lifestyle_mobile/native_voice',
  );
  static const _secure = FlutterSecureStorage();

  Future<void> _migrateOtherPlatform() async {
    final prefs = await SharedPreferences.getInstance();
    final legacy = prefs.getString(WalletIngestToken.storageKey);
    if (legacy == null) return;
    if (await _secure.read(key: WalletIngestToken.storageKey) == null) {
      await _secure.write(key: WalletIngestToken.storageKey, value: legacy);
    }
    await prefs.remove(WalletIngestToken.storageKey);
  }

  @override
  Future<bool> hasTokenFor(String ownerId) async {
    if (Platform.isAndroid) {
      return await _channel.invokeMethod<bool>('hasWalletIngestTokenFor', {
            'ownerId': ownerId,
          }) ??
          false;
    }
    await _migrateOtherPlatform();
    final raw = await _secure.read(key: WalletIngestToken.storageKey);
    if (raw == null) return false;
    try {
      final value = jsonDecode(raw);
      return value is Map<String, dynamic> &&
          value['ownerId'] == ownerId &&
          value['token'] is String &&
          (value['token'] as String).isNotEmpty;
    } on FormatException {
      // Existing bare tokens have no owner and are never assigned one.
      return false;
    }
  }

  @override
  Future<void> writeBound(String token, String ownerId) async {
    if (Platform.isAndroid) {
      await _channel.invokeMethod<void>('storeBoundWalletIngestToken', {
        'token': token,
        'ownerId': ownerId,
      });
    } else {
      await _secure.write(
        key: WalletIngestToken.storageKey,
        value: jsonEncode({'token': token, 'ownerId': ownerId}),
      );
      await (await SharedPreferences.getInstance()).remove(
        WalletIngestToken.storageKey,
      );
    }
  }

  @override
  Future<void> clearIfMatches(String token) async {
    if (Platform.isAndroid) {
      await _channel.invokeMethod<void>('clearWalletIngestTokenIfMatches', {
        'token': token,
      });
      return;
    }
    final raw = await _secure.read(key: WalletIngestToken.storageKey);
    if (raw == null) return;
    try {
      final value = jsonDecode(raw);
      if (value is Map<String, dynamic> && value['token'] == token) {
        await _secure.delete(key: WalletIngestToken.storageKey);
      }
    } on FormatException {
      // Never erase an unrecognized value based on an inferred owner.
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
/// Pairing the token with an account does not bind older queued messages.
class WalletIngestToken {
  WalletIngestToken(this._api, {WalletCredentialStore? credentials})
      : _credentials = credentials ?? PlatformWalletCredentialStore();
  static const storageKey = 'lifestyle.wallet_ingest_token.v1';
  static const smsSyncKey = 'sms_sync_enabled';
  final ApiClient _api;
  final WalletCredentialStore _credentials;

  static int _generation = 0;
  static Future<void> _issueTail = Future<void>.value();
  static Future<void> _storageTail = Future<void>.value();

  static Future<void> _serialIssue(Future<void> Function() action) {
    final result = _issueTail.then((_) => action());
    _issueTail = result.catchError((Object _) {});
    return result;
  }

  static Future<void> _serialStorage(Future<void> Function() action) {
    final result = _storageTail.then((_) => action());
    _storageTail = result.catchError((Object _) {});
    return result;
  }

  /// Immediately makes any pending issue response stale, before logout awaits I/O.
  static void invalidatePending() => _generation++;

  Future<void> ensure({
    required String account,
    required String? Function() currentAccount,
    bool force = false,
  }) {
    final generation = _generation;
    return _serialIssue(() async {
      void checkAccount() {
        if (generation != _generation || currentAccount() != account) {
          throw StateError('Wallet credential request superseded');
        }
      }

      checkAccount();
      final prefs = await SharedPreferences.getInstance();
      checkAccount();
      if (!(prefs.getBool(smsSyncKey) ?? false)) return;
      if (!force && await _credentials.hasTokenFor(account)) {
        checkAccount();
        return;
      }
      checkAccount();
      final response =
          jsonObject(await _api.post('ingest/token'), 'ingest token');
      final ownerId = jsonString(response, 'ownerId');
      final token = jsonString(response, 'token');
      checkAccount();
      if (ownerId.toLowerCase() != account.toLowerCase()) {
        throw StateError('Wallet credential account mismatch');
      }
      await _serialStorage(() async {
        checkAccount();
        try {
          await _credentials.writeBound(token, ownerId);
          checkAccount();
        } catch (_) {
          // A write may have reached disk before failing or before sign-out.
          // Remove only this exact token, not a newer replacement.
          try {
            await _credentials.clearIfMatches(token);
          } catch (_) {
            // Cleanup is unconfirmed; surface the original failure to the caller.
          }
          rethrow;
        }
      });
    });
  }

  Future<void> revoke() {
    invalidatePending();
    // Start cleanup immediately, and reserve the revocation position before a
    // newer enable can enqueue an issue request.
    Object? cleanupError;
    StackTrace? cleanupStack;
    final cleanup = _serialStorage(() => _credentials.clear()).then<void>(
      (_) {},
      onError: (Object error, StackTrace stack) {
        cleanupError = error;
        cleanupStack = stack;
      },
    );
    return _serialIssue(() async {
      await cleanup;
      if (cleanupError != null) {
        Error.throwWithStackTrace(cleanupError!, cleanupStack!);
      }
      await _api.delete('ingest/token');
    });
  }

  static Future<void> clearLocal({WalletCredentialStore? credentials}) {
    invalidatePending();
    return _serialStorage(
        () => (credentials ?? PlatformWalletCredentialStore()).clear());
  }
}
