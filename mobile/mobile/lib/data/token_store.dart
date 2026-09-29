import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'session_tokens.dart';

abstract interface class TokenStore {
  Future<SessionTokens?> read();
  Future<void> write(SessionTokens tokens);
  Future<void> clear();
}

/// Stores the access/refresh pair in a single secure-storage entry so rotation
/// never leaves a half-written pair. The plugin uses Keychain on iOS and the
/// platform's encrypted secure storage on Android.
class SecureTokenStore implements TokenStore {
  SecureTokenStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'lifestyle.session.v1';
  final FlutterSecureStorage _storage;

  @override
  Future<SessionTokens?> read() async {
    final value = await _storage.read(key: _key);
    if (value == null) return null;
    try {
      return SessionTokens.decode(value);
    } on FormatException {
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(SessionTokens tokens) => _storage.write(
    key: _key,
    value: tokens.encode(),
    iOptions: const IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
aOptions: const AndroidOptions(),  );

  @override
  Future<void> clear() => _storage.delete(key: _key);
}
