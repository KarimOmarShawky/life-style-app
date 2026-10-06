import 'package:shared_preferences/shared_preferences.dart';

import 'session_tokens.dart';

abstract interface class TokenStore {
  Future<SessionTokens?> read();
  Future<void> write(SessionTokens tokens);
  Future<void> clear();
}

/// Stores the access/refresh pair in SharedPreferences for seamless cross-platform
/// reliability without native Windows C++/FFI compilation conflicts.
class PreferencesTokenStore implements TokenStore {
  static const _key = 'lifestyle.session.v1';

  @override
  Future<SessionTokens?> read() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_key);
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
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, tokens.encode());
  }

  @override
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
