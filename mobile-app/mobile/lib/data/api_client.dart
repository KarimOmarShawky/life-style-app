import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:lifestyle_mobile/core/archive/archive_cancellation.dart';
import 'package:lifestyle_mobile/core/archive/archive_verifier.dart';

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
    http.Client Function()? archiveClientFactory,
  })  : _baseUri = baseUri.replace(
          path: baseUri.path.endsWith('/') ? baseUri.path : '${baseUri.path}/',
        ),
        _tokenStore = tokenStore,
        _httpClient = httpClient ?? http.Client(),
        _archiveClientFactory = archiveClientFactory ?? http.Client.new;

  final Uri _baseUri;
  final TokenStore _tokenStore;
  final http.Client _httpClient;
  final http.Client Function() _archiveClientFactory;
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
    Map<String, String>? headers,
    bool authenticated = true,
  }) =>
      request(
        'POST',
        path,
        body: body,
        headers: headers,
        authenticated: authenticated,
      );

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
    Map<String, String>? headers,
    bool authenticated = true,
  }) async {
    final uri = _uri(path, query);
    final initialTokens = authenticated ? await _tokenStore.read() : null;
    var response = await _send(
      method,
      uri,
      body,
      initialTokens?.accessToken,
      headers: headers,
    );
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
      response = await _send(
        method,
        uri,
        body,
        refreshedTokens.accessToken,
        headers: headers,
      );
      exception = _exceptionFor(response);
    }

    if (exception != null) throw exception;
    return _decodeSuccess(response);
  }

  /// Dedicated streaming connection. Refresh only an explicit pre-body TOKEN_EXPIRED,
  /// once; never replay a partial archive or a lost/uncertain response.
  Stream<List<int>> streamAccountArchive(
      String password, ArchiveCancellation cancel) async* {
    cancel.check();
    final client = _archiveClientFactory();
    var closed = false;
    void close() {
      if (!closed) {
        closed = true;
        client.close();
      }
    }

    unawaited(cancel.whenCancelled.then((_) => close()));
    final deadline = Timer(const Duration(seconds: 90), cancel.cancel);
    try {
      var tokens = await cancel.bind(_tokenStore.read());
      for (var attempt = 0; attempt < 2; attempt++) {
        cancel.check();
        final currentTokens = tokens;
        if (currentTokens == null) {
          throw const ApiException(
              statusCode: 401,
              code: 'UNAUTHENTICATED',
              message: 'Sign in again before exporting.');
        }
        final request =
            http.Request('POST', _uri('users/me/export/archive', null))
              ..followRedirects = false
              ..maxRedirects = 0;
        request.headers.addAll({
          'accept': 'application/x-ndjson',
          'content-type': 'application/json; charset=utf-8',
          'authorization': 'Bearer ${currentTokens.accessToken}'
        });
        request.body = jsonEncode({'currentPassword': password});
        final response = await cancel
            .bind(client.send(request).timeout(const Duration(seconds: 30)));
        if (response.statusCode != 200) {
          // Error bodies are also bounded; do not use Response.fromStream or log raw bodies.
          final body = BytesBuilder(copy: false);
          await for (final chunk
              in response.stream.timeout(const Duration(seconds: 15))) {
            cancel.check();
            if (body.length + chunk.length > 64 * 1024) {
              throw const ArchiveException();
            }
            body.add(chunk);
          }
          var code = 'ARCHIVE_UNAVAILABLE';
          try {
            final error = jsonDecode(utf8.decode(body.takeBytes()));
            if (error is Map<String, dynamic> &&
                error['error'] is Map<String, dynamic>) {
              final candidate =
                  (error['error'] as Map<String, dynamic>)['code'];
              if (candidate == 'TOKEN_EXPIRED') code = 'TOKEN_EXPIRED';
            }
          } on FormatException {/* Never surface provider content. */}
          if (response.statusCode == 401 &&
              code == 'TOKEN_EXPIRED' &&
              attempt == 0) {
            await cancel.bind(_refreshAfterExpiry(currentTokens.accessToken));
            tokens = await cancel.bind(_tokenStore.read());
            continue;
          }
          throw ApiException(
              statusCode: response.statusCode,
              code: code,
              message:
                  'The archive could not be downloaded. Verify your session and password, then retry.');
        }
        if (response.headers['content-type']
                ?.split(';')
                .first
                .trim()
                .toLowerCase() !=
            'application/x-ndjson') {
          throw const ArchiveException();
        }
        await for (final chunk
            in response.stream.timeout(const Duration(seconds: 15))) {
          cancel.check();
          // Bound codec/verifier input even if a transport yields a larger buffer.
          for (var start = 0; start < chunk.length; start += 32 * 1024) {
            cancel.check();
            final end = start + 32 * 1024 < chunk.length
                ? start + 32 * 1024
                : chunk.length;
            yield chunk.sublist(start, end);
          }
        }
        cancel.check();
        return;
      }
      throw const ArchiveException();
    } on ApiException {
      rethrow;
    } on Object {
      throw const ArchiveException();
    } finally {
      deadline.cancel();
      close();
    }
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
          {
            'refreshToken': current.refreshToken,
          },
          null);
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
    String? accessToken, {
    Map<String, String>? headers,
  }) async {
    final request = http.Request(method, uri)
      ..followRedirects = false
      ..maxRedirects = 0;
    request.headers['accept'] = 'application/json';
    if (headers != null) {
      request.headers.addAll(headers);
    }
    if (body != null) {
      request.headers['content-type'] = 'application/json; charset=utf-8';
      request.body = jsonEncode(body);
    }
    if (accessToken != null) {
      request.headers['authorization'] = 'Bearer $accessToken';
    }

    try {
      final streamed =
          await _httpClient.send(request).timeout(const Duration(seconds: 30));
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
        message:
            'Could not connect to LifeStyle. Check your connection and try again.',
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
          code:
              error['code'] is String ? error['code'] as String : 'HTTP_ERROR',
          message: error['message'] is String
              ? error['message'] as String
              : 'The request could not be completed.',
          requestId: error['requestId'] is String
              ? error['requestId'] as String
              : null,
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
      final decoded = jsonDecode(response.body);
      // The API v1 contract wraps ordinary success payloads. Keep support for
      // legacy raw responses during rolling upgrades; health/export streams are
      // handled separately and are not unwrapped here.
      if (decoded is Map<String, dynamic> &&
          decoded['success'] == true &&
          decoded.containsKey('data')) {
        // Preserve the existing paginated feature contract while removing the
        // transport-only success flag from the wrapped response.
        if (decoded['meta'] is Map<String, dynamic>) {
          return {'data': decoded['data'], 'meta': decoded['meta']};
        }
        return decoded['data'];
      }
      return decoded;
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
