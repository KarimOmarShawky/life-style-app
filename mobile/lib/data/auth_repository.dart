import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'models.dart';
import 'session_tokens.dart';
import 'token_store.dart';

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

  Future<AppUser> login({required String email, required String password}) async {
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
        'locale': 'en',
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
      body: {'email': email.trim(), 'code': code, 'newPassword': newPassword},
    );
    await _tokens.clear();
  }

  Future<AppUser> getProfile() async {
    final response = await _api.get('users/me');
    final data = _map(response, 'profile response');
    return AppUser.fromJson(_map(data['user'], 'user'));
  }

  Future<void> logout() async {
    final session = await _tokens.read();
    try {
      if (session != null) {
        await _api.post(
          'auth/logout',
          body: {'refreshToken': session.refreshToken},
        );
      }
    } finally {
      await _tokens.clear();
    }
  }

  Future<AppUser> _saveAuthentication(Object? response) async {
    final data = _map(response, 'authentication response');
    final tokens = SessionTokens.fromJson(_map(data['tokens'], 'tokens'));
    final user = AppUser.fromJson(_map(data['user'], 'user'));
    await _tokens.write(tokens);
    return user;
  }

  Map<String, Object?> _device() {
    final platform = switch (defaultTargetPlatform) {
      TargetPlatform.iOS => 'ios',
      TargetPlatform.android => 'android',
      _ => 'unknown',
    };
    return {'platform': platform, 'name': 'LifeStyle mobile'};
  }
}

Map<String, dynamic> _map(Object? value, String name) {
  if (value is Map<String, dynamic>) return value;
  throw ApiException(
    statusCode: 502,
    code: 'INVALID_API_RESPONSE',
    message: 'The server returned an invalid $name.',
  );
}
