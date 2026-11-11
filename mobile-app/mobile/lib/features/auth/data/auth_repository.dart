import 'package:lifestyle_mobile/core/archive/archive_cancellation.dart';
import 'package:flutter/foundation.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';

class AuthRepository {
  const AuthRepository({required ApiClient api, required TokenStore tokens})
      : _api = api,
        _tokens = tokens;

  final ApiClient _api;
  final TokenStore _tokens;

  /// Prevent this API client's old requests from retrying on another session.
  void invalidateSessionRetries() => _api.invalidateSessionRetries();

  Future<AppUser?> restoreSession() async {
    final session = await _api.restoreSession();
    if (session == null) return null;
    try {
      return await getProfile();
    } on ApiException catch (error) {
      // A response fenced by an account transition must not clear the newer
      // account's credentials. Other 401 cleanup is still not atomic with an
      // independent engine or token-store write.
      if (error.statusCode == 401 && error.code != 'SESSION_CHANGED') {
        await _tokens.clear();
      }
      rethrow;
    }
  }

  Future<AppUser> login({
    required String email,
    required String password,
  }) async {
    invalidateSessionRetries();
    final response = await _api.post(
      'auth/login',
      authenticated: false,
      body: {'email': email.trim(), 'password': password, 'device': _device()},
    );
    return _saveAuthentication(response);
  }

  Future<AppUser> register({
    required String email,
    required String password,
    required String displayName,
  }) async {
    invalidateSessionRetries();
    final response = await _api.post(
      'auth/register',
      authenticated: false,
      body: {
        'email': email.trim(),
        'password': password,
        'displayName': displayName.trim(),
        'timezone': 'Africa/Cairo',
        'defaultCurrency': 'USD',
        'device': _device(),
      },
    );
    return _saveAuthentication(response);
  }

  Future<void> requestPasswordReset(String email) async {
    await _api.post(
      'auth/forgot-password',
      authenticated: false,
      body: {'email': email.trim()},
    );
  }

  Future<void> resetPassword({
    required String email,
    required String code,
    required String newPassword,
  }) async {
    await _api.post(
      'auth/reset-password',
      authenticated: false,
      body: {
        'email': email.trim(),
        'code': code.trim(),
        'newPassword': newPassword,
      },
    );
  }

  Future<AppUser> getProfile() async {
    final response = await _api.get('users/me');
    if (response is! Map<String, dynamic> ||
        response['user'] is! Map<String, dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid profile response.',
      );
    }
    return AppUser.fromJson(response['user'] as Map<String, dynamic>);
  }

  /// [onboardingCompleted] can only be set, never cleared (the server
  /// accepts `true` only); [productEventsEnabled] `false` also deletes the
  /// account's recorded usage events on the server.
  Future<AppUser> updateProfile({
    String? displayName,
    String? timezone,
    String? defaultCurrency,
    bool? productEventsEnabled,
    bool onboardingCompleted = false,
  }) async {
    final response = await _api.patch(
      'users/me',
      body: {
        if (displayName != null) 'displayName': displayName.trim(),
        if (timezone != null) 'timezone': timezone,
        if (defaultCurrency != null) 'defaultCurrency': defaultCurrency,
        if (productEventsEnabled != null)
          'productEventsEnabled': productEventsEnabled,
        if (onboardingCompleted) 'onboardingCompleted': true,
      },
    );
    if (response is! Map<String, dynamic> ||
        response['user'] is! Map<String, dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid profile response.',
      );
    }
    return AppUser.fromJson(response['user'] as Map<String, dynamic>);
  }

  Future<void> logout() async {
    invalidateSessionRetries();
    try {
      await _api.post('auth/logout', body: {});
    } finally {
      await _tokens.clear();
    }
  }

  Stream<List<int>> streamAccountArchive(
          String currentPassword, ArchiveCancellation cancel) =>
      _api.streamAccountArchive(currentPassword, cancel);

  Future<Map<String, dynamic>> exportUserData(String currentPassword) async {
    final response = await _api
        .post('users/me/export', body: {'currentPassword': currentPassword});
    if (response is! Map<String, dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid export response.',
      );
    }
    return response;
  }

  Future<DateTime?> scheduleAccountDeletion(String currentPassword) async {
    final response = await _api.post(
      'users/me/deletion',
      body: {'currentPassword': currentPassword},
    );
    if (response is Map<String, dynamic>) {
      final raw = response['deletionScheduledFor'];
      if (raw is String) {
        return DateTime.tryParse(raw)?.toLocal();
      }
    }
    return null;
  }

  Future<void> cancelAccountDeletion() async {
    await _api.delete('users/me/deletion');
  }

  Future<AppUser> _saveAuthentication(dynamic response) async {
    if (response is! Map<String, dynamic> ||
        response['tokens'] is! Map<String, dynamic> ||
        response['user'] is! Map<String, dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid authentication response.',
      );
    }

    final tokensJson = response['tokens'] as Map<String, dynamic>;
    final sessionTokens = SessionTokens(
      accessToken: tokensJson['accessToken'] as String,
      accessTokenExpiresAt: DateTime.parse(
        tokensJson['accessTokenExpiresAt'] as String,
      ),
      refreshToken: tokensJson['refreshToken'] as String,
      refreshTokenExpiresAt: DateTime.parse(
        tokensJson['refreshTokenExpiresAt'] as String,
      ),
    );

    await _tokens.write(sessionTokens);
    return AppUser.fromJson(response['user'] as Map<String, dynamic>);
  }

  // No device name is sent: the app has no source for a real one, and a fixed
  // placeholder made every device look the same in Signed-in devices (G6).
  Map<String, Object?> _device() => {
        'platform': _platformName(),
        'appVersion': '1.0.1',
      };

  String _platformName() {
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'android';
      case TargetPlatform.iOS:
        return 'ios';
      default:
        return 'unknown';
    }
  }
}
