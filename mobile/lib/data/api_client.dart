import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'session_tokens.dart';
import 'token_store.dart';

class ApiException implements Exception {
  const ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.requestId,
  });

  final int statusCode;
  final String code;
  final String message;
  final String? requestId;

  bool get isAuthenticationFailure =>
      statusCode == 401 &&
      (code == 'INVALID_REFRESH_TOKEN' || code == 'UNAUTHENTICATED');

  @override
  String toString() => message;
}

/// Thin REST transport for the native client. It handles the server's error
/// envelope and refreshes a session only for an explicit TOKEN_EXPIRED error.
class ApiClient {
  ApiClient({
    required Uri baseUri,
    required TokenStore tokenStore,
    http.Client? httpClient,
  })  : _baseUri = baseUri.replace(
          path: baseUri.path.endsWith('/') ? baseUri.path : '${baseUri.path}/',
        ),
        _tokenStore = tokenStore,
        _httpClient = httpClient ?? http.Client();

  final Uri _baseUri;
  final TokenStore _tokenStore;
  final http.Client _httpClient;
  Future<void>? _refreshFlight;

  void close() => _httpClient.close();

  Future<Object?> get(
    String path, {
    Map<String, String>? query,
    bool authenticated = true,
  }) =>
      request('GET', path, query: query, authenticated: authenticated);

  Future<Object?> post(
    String path, {
    Object? body,
    bool authenticated = true,
  }) =>
      request('POST', path, body: body, authenticated: authenticated);

  Future<Object?> patch(
    String path, {
    Object? body,
    bool authenticated = true,
  }) =>
      request('PATCH', path, body: body, authenticated: authenticated);

  Future<Object?> delete(
    String path, {
    Object? body,
    bool authenticated = true,
  }) =>
      request('DELETE', path, body: body, authenticated: authenticated);

  Future<Object?> request(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
    bool authenticated = true,
  }) async {
    final uri = _uri(path, query);
    final initialTokens = authenticated ? await _tokenStore.read() : null;
    var response = await _send(method, uri, body, initialTokens?.accessToken);
    var exception = _exceptionFor(response);

    if (authenticated &&
        initialTokens != null &&
        exception?.statusCode == 401 &&
        exception?.code == 'TOKEN_EXPIRED') {
      await _refreshAfterExpiry(initialTokens.accessToken);
      final refreshedTokens = await _tokenStore.read();
      if (refreshedTokens == null) {
        throw const ApiException(
          statusCode: 401,
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Your session has expired. Please sign in again.',
        );
      }
      response = await _send(method, uri, body, refreshedTokens.accessToken);
      exception = _exceptionFor(response);
    }

    if (exception != null) throw exception;
    return _decodeSuccess(response);
  }

  /// Rotates a stored refresh token during app restoration. A single request
  /// must consume each refresh token because the backend intentionally has no
  /// grace window and revokes a session on token reuse.
  Future<SessionTokens?> restoreSession() async {
    final current = await _tokenStore.read();
    if (current == null) return null;
    await _ensureRefresh(current);
    return _tokenStore.read();
  }

  Future<void> _refreshAfterExpiry(String accessTokenUsed) async {
    final stored = await _tokenStore.read();
    if (stored == null) {
      throw const ApiException(
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Your session has expired. Please sign in again.',
      );
    }
    // Another request may already have completed a rotation while this 401 was
    // in flight. Reuse its new access token; never submit its refresh token a
    // second time.
    if (stored.accessToken != accessTokenUsed) return;
    await _ensureRefresh(stored);
  }

  Future<void> _ensureRefresh(SessionTokens current) async {
    final inFlight = _refreshFlight;
    if (inFlight != null) {
      await inFlight;
      return;
    }

    final latest = await _tokenStore.read();
    if (latest == null) {
      throw const ApiException(
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Your session has expired. Please sign in again.',
      );
    }
    if (latest.accessToken != current.accessToken) return;

    final existingFlight = _refreshFlight;
    if (existingFlight != null) {
      await existingFlight;
      return;
    }

    final flight = _rotate(latest);
    _refreshFlight = flight;
    try {
      await flight;
    } finally {
      if (identical(_refreshFlight, flight)) _refreshFlight = null;
    }
  }

  Future<void> _rotate(SessionTokens current) async {
    try {
      final response = await _send(
        'POST',
        _uri('auth/refresh', null),
        {'refreshToken': current.refreshToken},
        null,
      );
      final error = _exceptionFor(response);
      if (error != null) throw error;
      final decoded = _decodeSuccess(response);
      final data = _asMap(decoded, 'token response');
      final tokenData = data['tokens'] is Map<String, dynamic>
          ? data['tokens'] as Map<String, dynamic>
          : data;
      await _tokenStore.write(SessionTokens.fromJson(tokenData));
    } catch (error) {
      // If the response was lost after the server committed rotation, retrying
      // the old opaque token would trigger strict reuse detection. Discard the
      // uncertain pair and require a fresh login instead.
      await _tokenStore.clear();
      if (error is ApiException) rethrow;
      throw const ApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: 'Could not renew your session. Please sign in again.',
      );
    }
  }

  Future<http.Response> _send(
    String method,
    Uri uri,
    Object? body,
    String? accessToken,
  ) async {
    final request = http.Request(method, uri)
      ..followRedirects = false
      ..maxRedirects = 0;
    request.headers['accept'] = 'application/json';
    if (body != null) {
      request.headers['content-type'] = 'application/json; charset=utf-8';
      request.body = jsonEncode(body);
    }
    if (accessToken != null) {
      request.headers['authorization'] = 'Bearer $accessToken';
    }

    try {
      final streamed = await _httpClient.send(request).timeout(const Duration(seconds: 30));
      final response = await http.Response.fromStream(streamed);
      if (response.statusCode >= 300 && response.statusCode < 400) {
        throw const ApiException(
          statusCode: 502,
          code: 'UNEXPECTED_REDIRECT',
          message: 'The API returned an unexpected redirect.',
        );
      }
      return response;
    } on ApiException {
      rethrow;
    } on Exception {
      throw const ApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: 'Could not connect to LifeStyle. Check your connection and try again.',
      );
    }
  }

  Uri _uri(String path, Map<String, String>? query) {
    final normalizedPath = path.startsWith('/') ? path.substring(1) : path;
    final uri = _baseUri.resolve(normalizedPath);
    return query == null ? uri : uri.replace(queryParameters: query);
  }

  ApiException? _exceptionFor(http.Response response) {
    if (response.statusCode < 400) return null;
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) {
        final error = decoded['error'] is Map<String, dynamic>
            ? decoded['error'] as Map<String, dynamic>
            : decoded;
        return ApiException(
          statusCode: response.statusCode,
          code: error['code'] is String ? error['code'] as String : 'HTTP_ERROR',
          message: error['message'] is String
              ? error['message'] as String
              : 'The request could not be completed.',
          requestId: error['requestId'] is String ? error['requestId'] as String : null,
        );
      }
    } on FormatException {
      // Use a safe generic message if the server didn't return JSON.
    }
    return ApiException(
      statusCode: response.statusCode,
      code: 'HTTP_ERROR',
      message: 'The request could not be completed (${response.statusCode}).',
    );
  }

  Object? _decodeSuccess(http.Response response) {
    if (response.statusCode == 204 || response.body.isEmpty) return null;
    try {
      return jsonDecode(response.body);
    } on FormatException {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid response.',
      );
    }
  }
}

Map<String, dynamic> _asMap(Object? value, String name) {
  if (value is Map<String, dynamic>) return value;
  throw ApiException(
    statusCode: 502,
    code: 'INVALID_API_RESPONSE',
    message: 'The server returned an invalid $name.',
  );
}
