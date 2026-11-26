import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'session_tokens.dart';

abstract interface class TokenStore {
  Future<SessionTokens?> read();
  Future<void> write(SessionTokens tokens);
  Future<void> clear();
}

/// A capability for operations fenced by their originating session.
/// Implementations unable to provide this capability must not be used as a
/// substitute for a session-bound credential operation.
abstract interface class SessionBoundTokenStore implements TokenStore {
  Future<SessionTokens?> readForSession(bool Function() isCurrent);
  Future<void> writeForSession(SessionTokens tokens, bool Function() isCurrent);
  Future<void> clearForSession(bool Function() isCurrent);
  Future<bool> clearIfMatches(SessionTokens expected, bool Function() isCurrent);
  Future<bool> replaceIfMatches(SessionTokens expected, SessionTokens replacement,
      bool Function() isCurrent);
}

class StaleCredentialOperation implements Exception {
  const StaleCredentialOperation();
}

/// Stores the access/refresh pair in a single secure-storage entry so rotation
/// never leaves a half-written pair. The plugin uses Keychain on iOS and the
/// platform's encrypted secure storage on Android.
///
/// Any legacy plaintext session entry in ordinary [SharedPreferences] is
/// scrubbed on read/write/clear so sensitive tokens never remain in
/// unencrypted preferences.
class SecureTokenStore implements SessionBoundTokenStore {
  SecureTokenStore({
    FlutterSecureStorage? storage,
    Future<SharedPreferences> Function()? legacyPreferences,
  })  : _storage = storage ?? const FlutterSecureStorage(),
        _legacyPreferences = legacyPreferences ?? SharedPreferences.getInstance;

  static const storageKey = 'lifestyle.session.v1';
  final FlutterSecureStorage _storage;
  final Future<SharedPreferences> Function() _legacyPreferences;

  // All instances accessing the same platform key share this in-isolate queue.
  // It does not coordinate other engines, isolates, or platform processes.
  static Future<void> _tail = Future<void>.value();

  static Future<T> _serialized<T>(Future<T> Function() work) {
    final result = _tail.then((_) => work());
    _tail = result.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return result;
  }

  static void _check(bool Function()? valid) {
    if (valid != null && !valid()) throw const StaleCredentialOperation();
  }

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
  Future<SessionTokens?> read() => _read(null);

  @override
  Future<SessionTokens?> readForSession(bool Function() isCurrent) =>
      _read(isCurrent);

  Future<SessionTokens?> _read(bool Function()? valid) => _serialized(() async {
        _check(valid);
        await _scrubLegacyPreferences();
        _check(valid);
        final value = await _storage.read(key: storageKey);
        _check(valid);
        if (value == null) return null;
        try {
          return SessionTokens.decode(value);
        } on FormatException {
          // This read and its cleanup hold the same queue slot. A newer write
          // cannot be deleted by cleanup of the malformed value we observed.
          _check(valid);
          await _storage.delete(key: storageKey);
          _check(valid);
          return null;
        }
      });

  @override
  Future<void> write(SessionTokens tokens) => _write(tokens, null);

  @override
  Future<void> writeForSession(SessionTokens tokens, bool Function() isCurrent) =>
      _write(tokens, isCurrent);

  Future<void> _write(SessionTokens tokens, bool Function()? valid) =>
      _serialized(() async {
        _check(valid);
        await _scrubLegacyPreferences();
        _check(valid);
        await _storage.write(
          key: storageKey,
          value: tokens.encode(),
          iOptions: const IOSOptions(
            accessibility: KeychainAccessibility.first_unlock_this_device,
          ),
          aOptions: const AndroidOptions(),
        );
        _check(valid);
      });

  /// Comparison and mutation share one queue slot, but are not platform CAS.
  Future<bool> _mutateIfMatches(SessionTokens expected, SessionTokens? replacement,
      bool Function() valid) => _serialized(() async {
        _check(valid);
        await _scrubLegacyPreferences();
        _check(valid);
        final raw = await _storage.read(key: storageKey);
        _check(valid);
        if (raw == null) return false;
        SessionTokens actual;
        try {
          actual = SessionTokens.decode(raw);
        } on FormatException {
          // This operation does not own an unrecognized value.
          return false;
        }
        if (actual.accessToken != expected.accessToken ||
            actual.refreshToken != expected.refreshToken) return false;
        _check(valid);
        if (replacement == null) {
          await _storage.delete(key: storageKey);
        } else {
          await _storage.write(
            key: storageKey,
            value: replacement.encode(),
            iOptions: const IOSOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
            aOptions: const AndroidOptions(),
          );
        }
        _check(valid);
        return true;
      });

  @override
  Future<bool> clearIfMatches(SessionTokens expected, bool Function() isCurrent) =>
      _mutateIfMatches(expected, null, isCurrent);

  @override
  Future<bool> replaceIfMatches(SessionTokens expected, SessionTokens replacement,
          bool Function() isCurrent) =>
      _mutateIfMatches(expected, replacement, isCurrent);

  @override
  Future<void> clear() => _clear(null);

  @override
  Future<void> clearForSession(bool Function() isCurrent) => _clear(isCurrent);

  Future<void> _clear(bool Function()? valid) => _serialized(() async {
        _check(valid);
        await _scrubLegacyPreferences();
        _check(valid);
        await _storage.delete(key: storageKey);
        _check(valid);
      });
}
