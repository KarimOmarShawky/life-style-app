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

  /// Decodes one already-stored value without touching the store.
  ///
  /// Returns null when the value cannot be authenticated (invalidated key or
  /// damaged ciphertext), which is how a quarantined entry is re-checked
  /// without first moving it back into a live queue. Throws
  /// [WalletQueueSecurityException] when the platform cipher is unavailable.
  Future<String?> unseal(String stored);

  /// Encodes and writes one entry. Fails closed when no platform cipher exists
  /// or when the write does not reach disk.
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
    return unseal(stored);
  }

  @override
  Future<String?> unseal(String stored) async {
    if (!_isEnvelope(stored)) return stored; // version 1: migrate on next write
    try {
      return await _channel
          .invokeMethod<String>(_decryptMethod, {'value': stored});
    } on MissingPluginException {
      throw WalletQueueSecurityException(
        'Wallet queue entries are encrypted and cannot be read on this platform',
      );
    } on PlatformException {
      // Authenticated decryption failed: the key rotated or the bytes are
      // damaged. The caller quarantines the entry instead of dropping it.
      return null;
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
    // A write that did not reach disk must never look like a stored review (V-02).
    final bool committed = await prefs.setString(key, sealed);
    if (!committed) {
      throw WalletQueueSecurityException(
        'Wallet queue entry could not be written to disk',
      );
    }
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
  Future<String?> unseal(String stored) async => stored;

  @override
  Future<void> write(SharedPreferences prefs, String key, String value) async {
    final bool committed = await prefs.setString(key, value);
    if (!committed) {
      throw WalletQueueSecurityException(
        'Wallet queue entry could not be written to disk',
      );
    }
  }
}
