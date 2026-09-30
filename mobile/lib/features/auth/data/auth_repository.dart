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

  Future<AppUser?> restoreSession() async {
    final session = await _api.restoreSession();
    if (session == null) return null;
    try {
      return await getProfile();
    } on ApiException catch (error) {
      if (error.statusCode == 401) await _tokens.clear();
      rethrow;
    }
  }

  Future<AppUser> login({
    required String email,
    required String password,
  }) async {
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
      'auth/password/reset/request',
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
      'auth/password/reset/confirm',
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

  Future<void> logout() async {
    try {
      await _api.post('auth/logout', body: {});
    } finally {
      await _tokens.clear();
    }
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

  Map<String, Object?> _device() => {
    'platform': _platformName(),
    'name': 'Arena Mobile Client',
    'deviceName': 'Arena Mobile Client',
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
