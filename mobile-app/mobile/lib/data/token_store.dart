import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'session_tokens.dart';

abstract interface class TokenStore {
  Future<SessionTokens?> read();
  Future<void> write(SessionTokens tokens);
  Future<void> clear();
}

/// Stores the access/refresh pair in a single secure-storage entry so rotation
/// never leaves a half-written pair. The plugin uses Keychain on iOS and the
/// platform's encrypted secure storage on Android.
///
/// Any legacy plaintext session entry in ordinary [SharedPreferences] is
/// scrubbed on read/write/clear so sensitive tokens never remain in
/// unencrypted preferences.
class SecureTokenStore implements TokenStore {
  SecureTokenStore({
    FlutterSecureStorage? storage,
    Future<SharedPreferences> Function()? legacyPreferences,
  })  : _storage = storage ?? const FlutterSecureStorage(),
        _legacyPreferences = legacyPreferences ?? SharedPreferences.getInstance;

  static const storageKey = 'lifestyle.session.v1';
  final FlutterSecureStorage _storage;
  final Future<SharedPreferences> Function() _legacyPreferences;

  Future<void> _scrubLegacyPreferences() async {
    try {
      final prefs = await _legacyPreferences();
      if (prefs.containsKey(storageKey)) {
        await prefs.remove(storageKey);
      }
    } on Object {
      // Best-effort cleanup of obsolete SharedPreferences token key.
    }
  }

  @override
  Future<SessionTokens?> read() async {
    await _scrubLegacyPreferences();
    final value = await _storage.read(key: storageKey);
    if (value == null) return null;
    try {
      return SessionTokens.decode(value);
    } on FormatException {
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(SessionTokens tokens) async {
    await _scrubLegacyPreferences();
    await _storage.write(
      key: storageKey,
      value: tokens.encode(),
      iOptions: const IOSOptions(
        accessibility: KeychainAccessibility.first_unlock_this_device,
      ),
      aOptions: const AndroidOptions(),
    );
  }

  @override
  Future<void> clear() async {
    await _scrubLegacyPreferences();
    await _storage.delete(key: storageKey);
  }
}
