import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Seals and unseals local wallet queue entries (F-05).
///
/// Candidates, review items and pending transactions hold sanitized SMS text,
/// senders and financial amounts. On Android the native receiver writes them
/// too, so both sides share one device-bound AES-GCM key that never leaves the
/// platform keystore. Entries are stored as
/// `{"v":2,"iv":"…","ct":"…"}`; version 1 (raw JSON) values are still readable
/// so queued data migrates instead of disappearing.
abstract class WalletQueueCodec {
  /// Reads and decodes one stored entry. Version 1 values are returned as-is.
  Future<String?> read(SharedPreferences prefs, String key);

  /// Encodes and writes one entry. Fails closed when no platform cipher exists.
  Future<void> write(SharedPreferences prefs, String key, String value);
}

/// Thrown when an entry cannot be protected; callers must not fall back to
/// plaintext storage.
class WalletQueueSecurityException implements Exception {
  WalletQueueSecurityException(this.message);

  final String message;

  @override
  String toString() => 'WalletQueueSecurityException: $message';
}

/// Android implementation: the key lives in the Android Keystore, so Dart only
/// exchanges ciphertext over the existing platform channel.
class PlatformWalletQueueCodec implements WalletQueueCodec {
  PlatformWalletQueueCodec({MethodChannel? channel})
      : _channel = channel ??
            const MethodChannel('com.example.lifestyle_mobile/native_voice');

  static const String _encryptMethod = 'encryptWalletPayload';
  static const String _decryptMethod = 'decryptWalletPayload';

  final MethodChannel _channel;

  static bool _isEnvelope(String value) {
    if (!value.startsWith('{"v":')) return false;
    final marker = RegExp(r'"v"\s*:\s*(\d+)').firstMatch(value);
    if (marker == null) return false;
    return (int.tryParse(marker.group(1)!) ?? 0) >= 2;
  }

  @override
  Future<String?> read(SharedPreferences prefs, String key) async {
    final stored = prefs.getString(key);
    if (stored == null) return null;
    if (!_isEnvelope(stored)) return stored; // version 1: migrate on next write
    try {
      return await _channel
          .invokeMethod<String>(_decryptMethod, {'value': stored});
    } on MissingPluginException {
      throw WalletQueueSecurityException(
        'Wallet queue entries are encrypted and cannot be read on this platform',
      );
    } on PlatformException catch (error) {
      throw WalletQueueSecurityException(
        'Wallet queue entry could not be decrypted (${error.code})',
      );
    }
  }

  @override
  Future<void> write(SharedPreferences prefs, String key, String value) async {
    final String sealed;
    try {
      sealed = (await _channel
          .invokeMethod<String>(_encryptMethod, {'value': value}))!;
    } on MissingPluginException {
      throw WalletQueueSecurityException(
        'Wallet queue entries cannot be encrypted on this platform',
      );
    } on PlatformException catch (error) {
      throw WalletQueueSecurityException(
        'Wallet queue entry could not be encrypted (${error.code})',
      );
    }
    await prefs.setString(key, sealed);
  }
}

/// Stores entries verbatim. Only for tests: it provides no protection and must
/// never be wired into the app.
class PlainWalletQueueCodec implements WalletQueueCodec {
  const PlainWalletQueueCodec();

  @override
  Future<String?> read(SharedPreferences prefs, String key) async =>
      prefs.getString(key);

  @override
  Future<void> write(SharedPreferences prefs, String key, String value) async {
    await prefs.setString(key, value);
  }
}
